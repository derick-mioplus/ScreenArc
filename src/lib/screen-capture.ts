// Renderer-side helper for capturing the screen on macOS via Chromium's
// MediaRecorder, working around the broken FFmpeg avfoundation screen input
// on macOS 14+ (Sequoia).
//
// Pipeline:
//   1. desktopCapturer.getSources() resolves the user's chosen display.id
//      to a chromeMediaSourceId.
//   2. getUserMedia({chromeMediaSource:'desktop',chromeMediaSourceId})
//      returns a video-only MediaStream backed by ScreenCaptureKit. This
//      bypasses the system display picker and getDisplayMedia entirely.
//   3. When the user enabled system audio, we run the existing loopback
//      flow (enableLoopbackAudio + getDisplayMedia) and graft the audio
//      track onto the video stream so a single MediaRecorder produces one
//      WebM file with both video + audio.
//   4. MediaRecorder writes 1-second WebM clusters; chunks are forwarded
//      to the main process over IPC and appended to the on-disk file.

const CHUNK_INTERVAL_MS = 1000
let captureLock: Promise<void> = Promise.resolve()

export interface ScreenCaptureHandle {
  stop: () => Promise<void>
  /** True until stop() resolves. Useful for guarding cleanup. */
  isActive: () => boolean
  /** True iff a system-audio track was successfully grafted onto the stream. */
  hasSystemAudio: () => boolean
}

export interface StartScreenCaptureOptions {
  /** Selected display.id from the recorder UI. Resolved to a source id. */
  displayId?: number
  /** Capture the system-audio loopback alongside the video stream. */
  includeSystemAudio: boolean
  /** Bitrate hint forwarded to MediaRecorder for video. Default: 8 Mbps. */
  videoBitsPerSecond?: number
  /** Bitrate hint forwarded to MediaRecorder for audio. Default: 128 kbps. */
  audioBitsPerSecond?: number
  /** Called if MediaRecorder errors out mid-recording. */
  onError?: (err: Error) => void
}

/**
 * Begin renderer-side screen capture. Returns a handle whose stop() drains
 * pending chunks before resolving.
 *
 * Throws if Screen Recording permission is denied (no sources returned),
 * MediaRecorder cannot be constructed, or — when system audio was requested —
 * the loopback flow fails. Caller treats this as fatal and aborts the
 * recording.
 */
export async function startScreenCapture(opts: StartScreenCaptureOptions): Promise<ScreenCaptureHandle> {
  const api = window.electronAPI

  // Serialize start() across overlapping recordings so two streams never
  // contend for the loopback flag at once.
  let releaseLock!: () => void
  const priorLock = captureLock
  captureLock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })

  let videoStream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let hasSystemAudio = false

  try {
    await priorLock

    // 1. Resolve the chosen display to a chromeMediaSourceId. If no displayId
    //    was provided, fall back to the first screen.
    const sources = await api.getScreenSources()
    if (sources.length === 0) {
      throw new Error('No screen sources available — Screen Recording permission may be denied.')
    }
    const targetSource =
      (opts.displayId !== undefined && sources.find((s) => s.display_id === String(opts.displayId))) ||
      sources[0]

    // 2. Capture screen video. The cast is required because Chromium's
    //    legacy chromeMediaSource constraint is not in lib.dom.d.ts.
    videoStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: targetSource.id,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    if (!videoStream || videoStream.getVideoTracks().length === 0) {
      throw new Error('Screen capture returned no video tracks.')
    }

    // 3. If requested, fetch a system-audio track via the existing loopback
    //    flow and graft it onto the video stream. We swallow loopback failures
    //    and fall back to video-only — system audio is always optional.
    if (opts.includeSystemAudio) {
      try {
        await api.enableLoopbackAudio()
        let loopbackStream: MediaStream | null = null
        try {
          loopbackStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
        } finally {
          await api.disableLoopbackAudio()
        }

        // Drop the duplicate video track from the loopback stream — we keep
        // only the audio track and add it to our screen stream.
        loopbackStream.getVideoTracks().forEach((track) => {
          try {
            track.stop()
          } catch {
            // ignore
          }
          loopbackStream!.removeTrack(track)
        })

        const audioTrack = loopbackStream.getAudioTracks()[0]
        if (audioTrack) {
          videoStream.addTrack(audioTrack)
          hasSystemAudio = true
        } else {
          console.warn('[ScreenCapture] Loopback returned no audio track; continuing without system audio.')
        }
      } catch (err) {
        console.error('[ScreenCapture] System audio loopback failed; continuing without system audio:', err)
        // Fall through — recording proceeds without system audio.
      }
    }

    // 4. Pick a MediaRecorder MIME type. VP9+Opus is preferred (smaller files,
    //    higher quality); VP8+Opus is the universal fallback.
    const mimeCandidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
      'video/webm',
    ]
    const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''

    const recorderOptions: MediaRecorderOptions = {
      videoBitsPerSecond: opts.videoBitsPerSecond ?? 8_000_000,
      audioBitsPerSecond: opts.audioBitsPerSecond ?? 128_000,
    }
    if (mimeType) recorderOptions.mimeType = mimeType

    try {
      recorder = new MediaRecorder(videoStream, recorderOptions)
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
    }
  } catch (err) {
    // Roll back: stop tracks, free resources, then rethrow. Do this before
    // releasing the lock so a follow-up start() sees a clean slate.
    if (videoStream) videoStream.getTracks().forEach((t) => t.stop())
    releaseLock()
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    // The lock guards getDisplayMedia + loopback toggling above. Past this
    // point the recorder is independent and other captures can start.
    releaseLock()
  }

  let active = true
  const pendingChunkWrites = new Set<Promise<void>>()

  recorder.ondataavailable = async (event: BlobEvent) => {
    if (!event.data || event.data.size === 0) return
    const writeTask = (async () => {
      try {
        const buf = await event.data.arrayBuffer()
        await api.writeScreenVideoChunk(buf)
      } catch (err) {
        console.error('[ScreenCapture] Failed to forward chunk:', err)
        // Don't kill the capture on transient IPC failures — the writer
        // serializes chunks and surfaces hard errors at finalize time.
      }
    })()

    pendingChunkWrites.add(writeTask)
    try {
      await writeTask
    } finally {
      pendingChunkWrites.delete(writeTask)
    }
  }

  recorder.onerror = (event: Event) => {
    const err = (event as unknown as { error?: Error }).error ?? new Error('MediaRecorder error')
    console.error('[ScreenCapture] MediaRecorder error:', err)
    active = false
    opts.onError?.(err)
  }

  // Emit a chunk every CHUNK_INTERVAL_MS so the main process sees data
  // continuously and a crash mid-recording leaves only ~1s of video at risk.
  recorder.start(CHUNK_INTERVAL_MS)

  const stop = async () => {
    if (!active) return
    active = false

    if (recorder!.state !== 'inactive') {
      try {
        recorder!.requestData()
      } catch {
        // requestData throws if not recording; safe to ignore.
      }

      await new Promise<void>((resolve) => {
        const onStop = () => {
          recorder!.removeEventListener('stop', onStop)
          resolve()
        }
        recorder!.addEventListener('stop', onStop)
        try {
          recorder!.stop()
        } catch {
          resolve()
        }
      })
    }

    videoStream!.getTracks().forEach((t) => {
      try {
        t.stop()
      } catch {
        // ignore
      }
    })

    await Promise.allSettled(Array.from(pendingChunkWrites))
  }

  return {
    stop,
    isActive: () => active,
    hasSystemAudio: () => hasSystemAudio,
  }
}
