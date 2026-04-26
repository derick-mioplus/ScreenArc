// Renderer-side helper for capturing macOS system audio via
// electron-audio-loopback + MediaRecorder, streaming WebM/Opus chunks to the
// main process over IPC.
//
// We intentionally avoid pulling the audio into a Web Audio graph: passing the
// raw MediaStream directly to MediaRecorder lets Chromium use the native macOS
// Opus encoder (lower CPU and no extra resampling).

const CHUNK_INTERVAL_MS = 1000

export interface SystemAudioCaptureHandle {
  stop: () => Promise<void>
  /** True until stop() resolves. Useful for guarding cleanup. */
  isActive: () => boolean
}

export interface StartOptions {
  /** Bitrate hint for the MediaRecorder. Default: 128 kbps. */
  audioBitsPerSecond?: number
  /** Called if capture setup fails after the recording has already started. */
  onError?: (err: Error) => void
}

/**
 * Begin capturing system audio. The returned handle lets the caller stop
 * capture explicitly; capture also stops automatically if the underlying
 * MediaRecorder errors out.
 *
 * Throws if permission is denied, the platform doesn't support loopback, or
 * the API is otherwise unavailable. Caller should treat this as recoverable —
 * the screen recording can proceed without system audio.
 */
export async function startSystemAudioCapture(opts: StartOptions = {}): Promise<SystemAudioCaptureHandle> {
  const api = window.electronAPI

  // Toggle the loopback flag so the next getDisplayMedia() returns a
  // system-audio track. We disable the flag immediately after the call so
  // unrelated screen-share requests later don't accidentally pick it up.
  await api.enableLoopbackAudio()
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
  } finally {
    await api.disableLoopbackAudio()
  }

  // We only want audio; drop video tracks immediately.
  stream.getVideoTracks().forEach((track) => {
    try {
      track.stop()
    } catch {
      // ignore
    }
    stream.removeTrack(track)
  })

  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('System audio capture returned no audio tracks (NSAudioCaptureUsageDescription missing?)')
  }

  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: opts.audioBitsPerSecond ?? 128_000,
    })
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop())
    throw err instanceof Error ? err : new Error(String(err))
  }

  let active = true

  recorder.ondataavailable = async (event: BlobEvent) => {
    if (!event.data || event.data.size === 0) return
    try {
      const buf = await event.data.arrayBuffer()
      await api.writeSystemAudioChunk(buf)
    } catch (err) {
      console.error('[SystemAudio] Failed to forward chunk:', err)
      // We don't kill the capture on transient IPC failures; the writer
      // serializes chunks and surfaces hard errors at finalize time.
    }
  }

  recorder.onerror = (event: Event) => {
    const err = (event as unknown as { error?: Error }).error ?? new Error('MediaRecorder error')
    console.error('[SystemAudio] MediaRecorder error:', err)
    active = false
    opts.onError?.(err)
  }

  // Emit a chunk every CHUNK_INTERVAL_MS so the main process sees data
  // continuously and a crash mid-recording leaves only ~1s of audio at risk.
  recorder.start(CHUNK_INTERVAL_MS)

  const stop = async () => {
    if (!active) return
    active = false

    if (recorder.state !== 'inactive') {
      // requestData() forces one final ondataavailable before stop() so the
      // tail of the recording isn't lost.
      try {
        recorder.requestData()
      } catch {
        // requestData throws if not recording; safe to ignore
      }

      await new Promise<void>((resolve) => {
        const onStop = () => {
          recorder.removeEventListener('stop', onStop)
          resolve()
        }
        recorder.addEventListener('stop', onStop)
        try {
          recorder.stop()
        } catch {
          resolve()
        }
      })
    }

    stream.getTracks().forEach((t) => {
      try {
        t.stop()
      } catch {
        // ignore
      }
    })
  }

  return {
    stop,
    isActive: () => active,
  }
}
