import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Microphone,
  MicrophoneOff,
  DeviceComputerCamera,
  DeviceComputerCameraOff,
  DeviceDesktop,
  Loader2,
  Video,
  X,
  Marquee2,
  Pointer,
  Folder,
  Square,
  Volume,
  VolumeOff,
} from 'tabler-icons-react'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { useDeviceManager } from '../hooks/useDeviceManager'
import { cn } from '../lib/utils'
import { startSystemAudioCapture, type SystemAudioCaptureHandle } from '../lib/system-audio'
import { startScreenCapture, type ScreenCaptureHandle } from '../lib/screen-capture'
import '../index.css'

// --- Constants ---
const LINUX_SCALES = [
  { value: 2, label: '2x' },
  { value: 1.5, label: '1.5x' },
  { value: 1, label: '1x' },
]
const WINDOWS_SCALES = [
  { value: 3, label: '3x' },
  { value: 2, label: '2x' },
  { value: 1, label: '1x' },
]

// --- Types ---
type RecordingState = 'idle' | 'preparing' | 'recording'
type ActionInProgress = 'none' | 'recording' | 'loading'
type RecordingSource = 'area' | 'fullscreen'
type DisplayInfo = { id: number; name: string; isPrimary: boolean }

export function RecorderPage() {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [isRecording, setIsRecording] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<ActionInProgress>('none')
  const [source, setSource] = useState<RecordingSource>('fullscreen')
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [selectedDisplayId, setSelectedDisplayId] = useState<string>('')
  const [selectedWebcamId, setSelectedWebcamId] = useState<string>('none')
  const [selectedMicId, setSelectedMicId] = useState<string>('none')
  const [systemAudioEnabled, setSystemAudioEnabled] = useState<boolean>(false)
  const [cursorScale, setCursorScale] = useState<number>(1)

  const { platform, webcams, mics, isInitializing, reload: reloadDevices } = useDeviceManager()
  const webcamPreviewRef = useRef<HTMLVideoElement>(null)
  const webcamStreamRef = useRef<MediaStream | null>(null)
  const systemAudioHandleRef = useRef<SystemAudioCaptureHandle | null>(null)
  const screenCaptureHandleRef = useRef<ScreenCaptureHandle | null>(null)
  const actionInProgressRef = useRef<ActionInProgress>('none')

  const supportsSystemAudio = platform === 'darwin'
  const usesRendererScreenCapture = platform === 'darwin'
  const isBusy = actionInProgress !== 'none'

  const setActionState = useCallback((next: ActionInProgress) => {
    actionInProgressRef.current = next
    setActionInProgress(next)
  }, [])

  const cursorScales = useMemo(() => (platform === 'win32' ? WINDOWS_SCALES : LINUX_SCALES), [platform])

  // Effect for initializing settings and devices from storage/system
  useEffect(() => {
    const initialize = async () => {
      try {
        const [savedWebcamId, savedMicId, savedCursorScale, fetchedDisplays] = await Promise.all([
          window.electronAPI.getSetting<string>('recorder.selectedWebcamId'),
          window.electronAPI.getSetting<string>('recorder.selectedMicId'),
          window.electronAPI.getSetting<number>('recorder.cursorScale'),
          window.electronAPI.getDisplays(),
        ])
        console.info('[Recorder] Loaded saved settings:', {
          savedWebcamId,
          savedMicId,
          savedCursorScale,
          displayCount: fetchedDisplays.length,
        })

        setSelectedWebcamId(savedWebcamId || 'none')
        setSelectedMicId(savedMicId || 'none')

        // System-audio capture is intentionally NOT persisted across sessions.
        // It always starts OFF — the user opts in per session. This avoids the
        // "I didn't know I was recording system audio" surprise and the stale
        // state where a stored=true value sticks even after permission is
        // revoked. We also clear any value left over from an earlier build of
        // the app that did persist this flag.
        setSystemAudioEnabled(false)
        try {
          await window.electronAPI.setSetting('recorder.systemAudioEnabled', false)
        } catch (err) {
          console.warn('[Recorder] Failed to clear legacy systemAudioEnabled setting:', err)
        }

        // Only set cursor scale from settings for Linux
        if (platform === 'linux') {
          const scale = savedCursorScale ?? 1
          setCursorScale(scale)
          window.electronAPI.setCursorScale(scale)
        }

        setDisplays(fetchedDisplays)
        const primary = fetchedDisplays.find((d) => d.isPrimary) || fetchedDisplays[0]
        if (primary) setSelectedDisplayId(String(primary.id))
      } catch (error) {
        console.error('[Recorder] Failed to initialize recorder settings:', error)
      }
    }
    initialize()
  }, [platform]) // Depend on platform to ensure correct logic is applied

  // Effect to validate saved settings against available devices after initialization
  useEffect(() => {
    if (isInitializing) return

    if (webcams.length > 0 && !webcams.some((w) => w.id === selectedWebcamId)) {
      setSelectedWebcamId('none')
    }
    if (mics.length > 0 && !mics.some((m) => m.id === selectedMicId)) {
      setSelectedMicId('none')
    }
    if (platform === 'linux' && !cursorScales.some((s) => s.value === cursorScale)) {
      setCursorScale(1)
      window.electronAPI.setCursorScale(1)
    }
  }, [isInitializing, webcams, mics, platform, cursorScales, selectedWebcamId, selectedMicId, cursorScale])

  // Best-effort: stop the active system-audio capture, releasing tracks
  // and flushing the final MediaRecorder chunk.
  const stopSystemAudio = useCallback(async () => {
    const handle = systemAudioHandleRef.current
    systemAudioHandleRef.current = null
    if (handle) {
      console.info('[Recorder] Stopping system-audio capture handle.')
      try {
        await handle.stop()
      } catch (err) {
        console.error('[Recorder] Failed to stop system audio capture:', err)
      }
    }
  }, [])

  // Best-effort: stop the active screen capture, releasing the screen
  // MediaStream and flushing the final video chunk.
  const stopScreenCapture = useCallback(async () => {
    const handle = screenCaptureHandleRef.current
    screenCaptureHandleRef.current = null
    if (handle) {
      console.info('[Recorder] Stopping screen capture handle.')
      try {
        await handle.stop()
      } catch (err) {
        console.error('[Recorder] Failed to stop screen capture:', err)
      }
    }
  }, [])

  // Effect to manage IPC listeners for recording completion
  useEffect(() => {
    const cleanupStarted = window.electronAPI.onRecordingStarted(() => {
      console.info('[Recorder] recording-started received from main.')
      setIsRecording(true)
      setActionState('none')
    })

    const cleanupFinished = window.electronAPI.onRecordingFinished(() => {
      console.info('[Recorder] recording-finished received from main.')
      setActionState('none')
      setRecordingState('idle')
      setIsRecording(false)
      // Recording finished (or canceled) — release any MediaRecorders if
      // they're still alive. Main process has already finalized the writers.
      void stopSystemAudio()
      void stopScreenCapture()
      reloadDevices() // Refresh device list in case something changed
    })

    // Main process tells us to stop the system-audio MediaRecorder before it
    // finalizes the writer. Honor it eagerly so the tail chunk is flushed.
    const cleanupStopSystemAudio = window.electronAPI.onStopSystemAudio?.(() => {
      console.info('[Recorder] recorder:stop-system-audio received from main.')
      void (async () => {
        try {
          await stopSystemAudio()
        } finally {
          try {
            await window.electronAPI.notifySystemAudioStopped()
          } catch (error) {
            console.error('[Recorder] Failed to acknowledge system-audio stop to main process:', error)
          }
        }
      })()
    })

    // Same dance for the screen-capture MediaRecorder.
    const cleanupStopScreenCapture = window.electronAPI.onStopScreenCapture?.(() => {
      console.info('[Recorder] recorder:stop-screen-capture received from main.')
      void (async () => {
        try {
          await stopScreenCapture()
        } finally {
          try {
            await window.electronAPI.notifyScreenCaptureStopped()
          } catch (error) {
            console.error('[Recorder] Failed to acknowledge screen-capture stop to main process:', error)
          }
        }
      })()
    })

    return () => {
      cleanupStarted()
      cleanupFinished()
      cleanupStopSystemAudio?.()
      cleanupStopScreenCapture?.()
    }
  }, [reloadDevices, setActionState, stopSystemAudio, stopScreenCapture])

  // Effect to manage the webcam preview stream
  useEffect(() => {
    const videoEl = webcamPreviewRef.current
    const stopStream = () => {
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach((track) => track.stop())
        webcamStreamRef.current = null
      }
      if (videoEl) videoEl.srcObject = null
    }

    if (recordingState !== 'idle' || selectedWebcamId === 'none' || !videoEl) {
      stopStream()
      return
    }

    const startStream = async () => {
      stopStream()
      try {
        const constraints = { video: platform === 'win32' ? true : { deviceId: { exact: selectedWebcamId } } }
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        webcamStreamRef.current = stream
        if (videoEl) videoEl.srcObject = stream
      } catch (error) {
        console.error('Failed to start webcam preview stream:', error)
      }
    }

    startStream()
    return stopStream
  }, [selectedWebcamId, platform, recordingState])

  const handleStart = async () => {
    if (isRecording || actionInProgressRef.current !== 'none') return

    setActionState('recording')
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((track) => track.stop())
      webcamStreamRef.current = null
      if (webcamPreviewRef.current) webcamPreviewRef.current.srcObject = null
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    try {
      const webcam = selectedWebcamId !== 'none' ? webcams.find((d) => d.id === selectedWebcamId) : undefined
      const mic = selectedMicId !== 'none' ? mics.find((d) => d.id === selectedMicId) : undefined
      const wantSystemAudio = systemAudioEnabled && supportsSystemAudio

      console.info('[Recorder] handleStart called', {
        source,
        selectedDisplayId,
        platform,
        usesRendererScreenCapture,
        wantSystemAudio,
        hasMic: !!mic,
        hasWebcam: !!webcam,
      })

      // On macOS we capture the screen in the renderer because FFmpeg's
      // avfoundation screen input is broken on macOS 14+. The renderer's
      // ScreenCaptureKit-backed MediaRecorder writes a single WebM with
      // optional system audio folded in. Errors here are fatal — without a
      // screen recording there's nothing to mux.
      let systemAudioCarriedInScreenStream = false
      if (usesRendererScreenCapture) {
        try {
          screenCaptureHandleRef.current = await startScreenCapture({
            displayId: source === 'fullscreen' ? Number(selectedDisplayId) : undefined,
            includeSystemAudio: wantSystemAudio,
            onError: (err) => console.error('[Recorder] Screen capture failed mid-recording:', err),
          })
          systemAudioCarriedInScreenStream = screenCaptureHandleRef.current.hasSystemAudio()
          console.info('[Recorder] Screen capture started.', {
            hasSystemAudioInStream: systemAudioCarriedInScreenStream,
          })
        } catch (err) {
          console.error('[Recorder] Could not start screen capture:', err)
          screenCaptureHandleRef.current = null
          setActionState('none')
          setIsRecording(false)
          window.electronAPI.showMessageBox({
            type: 'warning',
            title: 'Screen Recording Permission Required',
            message: 'ScreenArc could not access the screen.',
            detail:
              'Go to System Settings → Privacy & Security → Screen Recording, enable the toggle next to "Electron" (the dev build), then restart the app and try again.',
            buttons: ['OK'],
          })
          return
        }
      }

      // Set up system-audio capture *before* starting the recording so the TCC
      // permission prompt fires up-front rather than mid-recording. On macOS
      // the screen capture above already grabbed system audio, so we skip the
      // separate system-audio capture path.
      let systemAudioReady = systemAudioCarriedInScreenStream
      if (wantSystemAudio && !usesRendererScreenCapture) {
        try {
          systemAudioHandleRef.current = await startSystemAudioCapture({
            onError: (err) => console.error('[Recorder] System audio capture failed mid-recording:', err),
          })
          systemAudioReady = true
        } catch (err) {
          console.error('[Recorder] Could not start system audio capture:', err)
          systemAudioHandleRef.current = null
          // Disable the toggle so it doesn't keep failing on retry
          setSystemAudioEnabled(false)
          window.electronAPI.setSetting('recorder.systemAudioEnabled', false)
          await stopScreenCapture()
          setActionState('none')
          setIsRecording(false)
          window.electronAPI.showMessageBox({
            type: 'warning',
            title: 'System Audio Permission Required',
            message: 'ScreenArc could not access system audio.',
            detail:
              'Go to System Settings → Privacy & Security → Screen Recording (macOS 14.3 and earlier) or Microphone (macOS 14.4+) and enable the toggle next to "Electron". Then re-enable System audio in the recorder and try again.',
            buttons: ['OK'],
          })
          return
        }
      }

      console.info('[Recorder] Calling main.startRecording with', {
        source,
        displayId: source === 'fullscreen' ? Number(selectedDisplayId) : undefined,
        hasWebcam: !!webcam,
        hasMic: !!mic,
        systemAudio: systemAudioReady,
      })

      const result = await window.electronAPI.startRecording({
        source,
        displayId: source === 'fullscreen' ? Number(selectedDisplayId) : undefined,
        webcam: webcam ? { deviceId: webcam.id, deviceLabel: webcam.id, index: webcams.indexOf(webcam) } : undefined,
        mic: mic ? { deviceId: mic.id, deviceLabel: mic.id, index: mics.indexOf(mic) } : undefined,
        systemAudio: systemAudioReady,
      })

      if (result.canceled) {
        console.warn('[Recorder] main.startRecording returned canceled.')
        // If the user canceled (or main returned canceled), make sure we don't
        // leak the MediaRecorders we already started.
        await stopSystemAudio()
        await stopScreenCapture()
        setActionState('none')
        setIsRecording(false)
      }
    } catch (error) {
      console.error('[Recorder] Failed to start recording:', error)
      await stopSystemAudio()
      await stopScreenCapture()
      setActionState('none')
      setIsRecording(false)
    }
  }

  const handleStop = () => {
    if (!isRecording || actionInProgressRef.current !== 'none') return

    setActionState('recording')
    window.electronAPI.stopRecording()
  }

  const handleLoadVideo = async () => {
    if (isRecording || actionInProgressRef.current !== 'none') return

    setActionState('loading')
    try {
      const result = await window.electronAPI.loadVideoFromFile()
      if (result.canceled) setActionState('none')
    } catch (error) {
      console.error('Failed to load video from file:', error)
      setActionState('none')
    }
  }

  const handleSelectionChange = (setter: (id: string) => void, key: string) => (id: string) => {
    setter(id)
    window.electronAPI.setSetting(key, id)
  }

  const handleCursorScaleChange = (value: string) => {
    const newScale = Number(value)
    setCursorScale(newScale)
    window.electronAPI.setCursorScale(newScale)
    window.electronAPI.setSetting('recorder.cursorScale', newScale)
  }

  return (
    <div className="relative h-screen w-screen bg-transparent select-none">
      <div className="absolute top-0 left-0 right-0 flex flex-col items-center pt-6">
        <div data-interactive="true" className="relative">
          {/* Main Control Bar */}
          <div
            className="relative flex items-center gap-3 px-4 py-3 rounded-2xl bg-card border border-border shadow-2xl"
            style={{ WebkitAppRegion: 'drag' }}
          >
            <button
              onClick={() => window.electronAPI.closeWindow()}
              style={{ WebkitAppRegion: 'no-drag' }}
              className="absolute -top-2.5 -left-2.5 z-20 flex items-center justify-center w-6 h-6 rounded-full bg-destructive/90 hover:bg-destructive text-white shadow-lg transition-all hover:scale-110"
              aria-label="Close Recorder"
              disabled={isRecording || isBusy}
            >
              <X className="w-3.5 h-3.5" />
            </button>

            {/* Source Toggle */}
            <div
              className="flex items-center p-1 bg-muted/60 rounded-xl border border-border/50"
              style={{ WebkitAppRegion: 'no-drag' }}
            >
              <SourceButton
                icon={<DeviceDesktop size={16} />}
                isActive={source === 'fullscreen'}
                onClick={() => setSource('fullscreen')}
                tooltip="Full Screen"
                disabled={isRecording || isBusy}
              />
              <SourceButton
                icon={<Marquee2 size={16} />}
                isActive={source === 'area'}
                onClick={() => setSource('area')}
                tooltip="Area"
                disabled={isRecording || isBusy}
              />
            </div>

            <div className="w-px h-8 bg-border/50"></div>

            {/* Device Selectors */}
            <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' }}>
              <Select
                value={selectedDisplayId}
                onValueChange={setSelectedDisplayId}
                disabled={source !== 'fullscreen' || isRecording || isBusy}
              >
                <SelectTrigger
                  variant="minimal"
                  className="w-auto min-w-[120px] max-w-[150px] h-9"
                  aria-label="Select display"
                >
                  <SelectValue asChild>
                    <div className="flex items-center gap-1.5 text-xs">
                      <DeviceDesktop size={14} className="text-primary shrink-0" />
                      <span className="truncate">
                        {displays.find((d) => String(d.id) === selectedDisplayId)?.name || '...'}
                      </span>
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {displays.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedWebcamId}
                onValueChange={handleSelectionChange(setSelectedWebcamId, 'recorder.selectedWebcamId')}
                disabled={isRecording || isBusy}
              >
                <SelectTrigger
                  variant="minimal"
                  className="w-auto min-w-[120px] max-w-[150px] h-9"
                  aria-label="Select webcam"
                >
                  <SelectValue asChild>
                    <div className="flex items-center gap-1.5 text-xs">
                      {selectedWebcamId !== 'none' ? (
                        <DeviceComputerCamera size={14} className="text-primary shrink-0" />
                      ) : (
                        <DeviceComputerCameraOff size={14} className="text-muted-foreground/60" />
                      )}
                      <span className={cn('truncate', selectedWebcamId === 'none' && 'text-muted-foreground')}>
                        {webcams.find((w) => w.id === selectedWebcamId)?.name || 'No webcam'}
                      </span>
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No webcam</SelectItem>
                  {webcams.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedMicId}
                onValueChange={handleSelectionChange(setSelectedMicId, 'recorder.selectedMicId')}
                disabled={isRecording || isBusy}
              >
                <SelectTrigger
                  variant="minimal"
                  className="w-auto min-w-[120px] max-w-[150px] h-9"
                  aria-label="Select microphone"
                >
                  <SelectValue asChild>
                    <div className="flex items-center gap-1.5 text-xs">
                      {selectedMicId !== 'none' ? (
                        <Microphone size={14} className="text-primary shrink-0" />
                      ) : (
                        <MicrophoneOff size={14} className="text-muted-foreground/60" />
                      )}
                      <span className={cn('truncate', selectedMicId === 'none' && 'text-muted-foreground')}>
                        {mics.find((m) => m.id === selectedMicId)?.name || 'No microphone'}
                      </span>
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No microphone</SelectItem>
                  {mics.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* System Audio Toggle (macOS only) — session-local, not persisted. */}
              {supportsSystemAudio && (
                <button
                  type="button"
                  onClick={async () => {
                    const next = !systemAudioEnabled
                    console.info(`[Recorder] System-audio toggle clicked. next=${next}`)
                    if (next) {
                      // Check permission before enabling. If not granted, the
                      // main process pops a dialog with a link to System
                      // Settings → Privacy & Security → Screen Recording, and
                      // we leave the toggle off until the user retries.
                      let status: 'granted' | 'denied' | 'not-determined' = 'denied'
                      try {
                        status = await window.electronAPI.checkScreenRecordingPermission()
                      } catch (err) {
                        console.error('[Recorder] checkScreenRecordingPermission threw:', err)
                      }
                      console.info(`[Recorder] Screen recording permission status: ${status}`)
                      if (status !== 'granted') return
                    }
                    setSystemAudioEnabled(next)
                  }}
                  disabled={isRecording || isBusy}
                  aria-pressed={systemAudioEnabled}
                  aria-label={systemAudioEnabled ? 'Disable system audio recording' : 'Enable system audio recording'}
                  title={
                    systemAudioEnabled
                      ? 'System audio: ON (recording desktop sound)'
                      : 'System audio: OFF (click to enable)'
                  }
                  className={cn(
                    'flex items-center gap-1.5 h-9 px-2.5 rounded-lg border text-xs transition-all',
                    systemAudioEnabled
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground hover:bg-background/50',
                    (isRecording || isBusy) && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  {systemAudioEnabled ? <Volume size={14} /> : <VolumeOff size={14} />}
                  <span className="truncate">System audio</span>
                </button>
              )}
            </div>

            <div className="w-px h-8 bg-border/50"></div>

            {/* Cursor Scale (Linux Only) */}
            {platform === 'linux' && (
              <>
                <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' }}>
                  <Pointer size={14} className="text-muted-foreground/60" />
                  <Select value={String(cursorScale)} onValueChange={handleCursorScaleChange} disabled={isRecording || isBusy}>
                    <SelectTrigger variant="minimal" className="w-[56px] h-9 text-xs" aria-label="Select cursor scale">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {cursorScales.map((s) => (
                        <SelectItem key={s.value} value={String(s.value)}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-px h-8 bg-border/50"></div>
              </>
            )}

            {/* Action Buttons */}
            <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' }}>
              <div className="flex items-center gap-2">
                {isRecording ? (
                  <Button
                    onClick={handleStop}
                    title="Stop Recording"
                    variant="destructive"
                    size="icon"
                    className="h-10 w-10 rounded-full shadow-lg"
                  >
                    <Square size={16} fill="currentColor" />
                  </Button>
                ) : (
                  <Button
                    onClick={handleStart}
                    title="Record"
                    disabled={isInitializing || isBusy}
                    size="icon"
                    className="h-10 w-10 rounded-full shadow-lg"
                  >
                    <Video size={18} />
                  </Button>
                )}
                <Button
                  onClick={handleLoadVideo}
                  title="Load from video"
                  disabled={isInitializing || isBusy || isRecording}
                  variant="secondary"
                  size="icon"
                  className="h-10 w-10 rounded-full shadow-lg"
                >
                  <Folder size={18} />
                </Button>
              </div>
              <div className="w-8 h-10 flex items-center justify-center">
                <Loader2
                  size={20}
                  className={cn(
                    'animate-spin text-primary transition-opacity duration-300',
                    actionInProgress !== 'none' || isInitializing ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </div>
            </div>
          </div>

          {/* Webcam Preview */}
          <div
            className={cn(
              'mt-4 mx-auto w-48 aspect-square rounded-[32%] overflow-hidden shadow-2xl bg-black ring-2 ring-border/20 transition-all duration-300',
              selectedWebcamId !== 'none' && actionInProgress === 'none' && !isRecording
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-95 pointer-events-none',
            )}
          >
            <video ref={webcamPreviewRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
        </div>
      </div>
    </div>
  )
}

const SourceButton = ({
  icon,
  isActive,
  tooltip,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ReactNode; isActive: boolean; tooltip?: string }) => (
  <button
    className={cn(
      'flex items-center justify-center w-10 h-9 rounded-lg transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring',
      isActive
        ? 'bg-primary shadow-sm text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
    )}
    title={tooltip}
    {...props}
  >
    {icon}
  </button>
)
