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
  const actionInProgressRef = useRef<ActionInProgress>('none')

  const supportsSystemAudio = platform === 'darwin'
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
        const [savedWebcamId, savedMicId, savedSystemAudio, savedCursorScale, fetchedDisplays] = await Promise.all([
          window.electronAPI.getSetting<string>('recorder.selectedWebcamId'),
          window.electronAPI.getSetting<string>('recorder.selectedMicId'),
          window.electronAPI.getSetting<boolean>('recorder.systemAudioEnabled'),
          window.electronAPI.getSetting<number>('recorder.cursorScale'),
          window.electronAPI.getDisplays(),
        ])

        setSelectedWebcamId(savedWebcamId || 'none')
        setSelectedMicId(savedMicId || 'none')
        // Only honor a saved value when the platform supports system audio.
        setSystemAudioEnabled(platform === 'darwin' && !!savedSystemAudio)

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
        console.error('Failed to initialize recorder settings:', error)
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
      try {
        await handle.stop()
      } catch (err) {
        console.error('[Recorder] Failed to stop system audio capture:', err)
      }
    }
  }, [])

  // Effect to manage IPC listeners for recording completion
  useEffect(() => {
    const cleanupStarted = window.electronAPI.onRecordingStarted(() => {
      setIsRecording(true)
      setActionState('none')
    })

    const cleanupFinished = window.electronAPI.onRecordingFinished(() => {
      setActionState('none')
      setRecordingState('idle')
      setIsRecording(false)
      // Recording finished (or canceled) — release the MediaRecorder if it's
      // still alive. Main process has already finalized the writer.
      void stopSystemAudio()
      reloadDevices() // Refresh device list in case something changed
    })

    // Main process tells us to stop the MediaRecorder before it finalizes the
    // writer. We honor it eagerly so the tail chunk is flushed.
    const cleanupStopSystemAudio = window.electronAPI.onStopSystemAudio?.(() => {
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

    return () => {
      cleanupStarted()
      cleanupFinished()
      cleanupStopSystemAudio?.()
    }
  }, [reloadDevices, setActionState, stopSystemAudio])

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

      // Set up system-audio capture *before* starting the recording so the TCC
      // permission prompt fires up-front rather than mid-recording. If it fails
      // (denied, unsupported), we proceed without system audio rather than
      // blocking the entire recording.
      let systemAudioReady = false
      if (wantSystemAudio) {
        try {
          systemAudioHandleRef.current = await startSystemAudioCapture({
            onError: (err) => console.error('[Recorder] System audio capture failed mid-recording:', err),
          })
          systemAudioReady = true
        } catch (err) {
          console.error('[Recorder] Could not start system audio capture; proceeding without it.', err)
          systemAudioHandleRef.current = null
        }
      }

      const result = await window.electronAPI.startRecording({
        source,
        displayId: source === 'fullscreen' ? Number(selectedDisplayId) : undefined,
        webcam: webcam ? { deviceId: webcam.id, deviceLabel: webcam.id, index: webcams.indexOf(webcam) } : undefined,
        mic: mic ? { deviceId: mic.id, deviceLabel: mic.id, index: mics.indexOf(mic) } : undefined,
        systemAudio: systemAudioReady,
      })

      if (result.canceled) {
        // If the user canceled (or main returned canceled), make sure we don't
        // leak the system-audio MediaRecorder we already started.
        await stopSystemAudio()
        setActionState('none')
        setIsRecording(false)
      }
    } catch (error) {
      console.error('Failed to start recording:', error)
      await stopSystemAudio()
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

              {/* System Audio Toggle (macOS only) */}
              {supportsSystemAudio && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !systemAudioEnabled
                    setSystemAudioEnabled(next)
                    window.electronAPI.setSetting('recorder.systemAudioEnabled', next)
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
