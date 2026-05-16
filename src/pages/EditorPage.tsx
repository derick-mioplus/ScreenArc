import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import { Preview } from '../components/editor/Preview'
import { SidePanel } from '../components/editor/SidePanel'
import { Timeline } from '../components/editor/Timeline'
import { PreviewControls } from '../components/editor/PreviewControls'
import { UpdateNotification } from '../components/editor/UpdateNotification'
import { ExportButton } from '../components/editor/ExportButton'
import { ExportModal } from '../components/editor/ExportModal'
import { WindowControls } from '../components/editor/WindowControls'
import { PresetModal } from '../components/editor/PresetModal'
import { SettingsModal } from '../components/settings/SettingsModal'
import { Stack3, Loader2, Check, Settings } from 'tabler-icons-react'
import { cn } from '../lib/utils'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useExportProcess } from '../hooks/useExportProcess'
import { Button } from '../components/ui/button'
import { useShallow } from 'zustand/react/shallow'

export function EditorPage() {
  const {
    loadProject,
    deleteRegion,
    initializePresets,
    initializeSettings,
    togglePlay,
    togglePreviewFullScreen,
    seekToNextFrame,
    seekToPreviousFrame,
    seekBackward,
    seekForward,
  } = useEditorStore.getState()
  const { presetSaveStatus, duration, isPreviewFullScreen } = useEditorStore(
    useShallow((state) => ({
      presetSaveStatus: state.presetSaveStatus,
      duration: state.duration,
      isPreviewFullScreen: state.isPreviewFullScreen,
    })),
  )
  const { undo, redo } = useEditorStore.temporal.getState()
  const {
    isModalOpen: isExportModalOpen,
    isExporting,
    progress: exportProgress,
    result: exportResult,
    openExportModal,
    closeExportModal,
    startExport,
    cancelExport,
  } = useExportProcess()

  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPresetModalOpen, setPresetModalOpen] = useState(false)
  const [isSettingsModalOpen, setSettingsModalOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ version: string; url: string } | null>(null)
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null)

  const handleDeleteSelectedRegion = useCallback(() => {
    const currentSelectedId = useEditorStore.getState().selectedRegionId
    if (currentSelectedId) {
      deleteRegion(currentSelectedId)
    }
  }, [deleteRegion])

  const handleSeekFrame = useCallback(
    (direction: 'next' | 'prev') => {
      if (direction === 'next') {
        seekToNextFrame()
      } else {
        seekToPreviousFrame()
      }
      if (videoRef.current) {
        videoRef.current.currentTime = useEditorStore.getState().currentTime
      }
    },
    [seekToNextFrame, seekToPreviousFrame],
  )

  const handleSeekByTime = useCallback(
    (seconds: number) => {
      if (seconds > 0) {
        seekForward(seconds)
      } else {
        seekBackward(Math.abs(seconds))
      }
      if (videoRef.current) {
        videoRef.current.currentTime = useEditorStore.getState().currentTime
      }
    },
    [seekForward, seekBackward],
  )

  useKeyboardShortcuts(
    {
      delete: handleDeleteSelectedRegion,
      backspace: handleDeleteSelectedRegion,
      ' ': (e) => {
        e.preventDefault()
        togglePlay()
      },
      j: () => handleSeekFrame('prev'),
      k: () => handleSeekFrame('next'),
      arrowleft: () => handleSeekByTime(-1),
      arrowright: () => handleSeekByTime(1),
      f: () => togglePreviewFullScreen(),
      'ctrl+z': (e) => {
        e.preventDefault()
        undo()
      },
      'ctrl+y': (e) => {
        e.preventDefault()
        redo()
      },
      'ctrl+shift+z': (e) => {
        e.preventDefault()
        redo()
      },
    },
    [handleDeleteSelectedRegion, undo, redo, togglePlay, handleSeekFrame, togglePreviewFullScreen],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isPreviewFullScreen) {
        togglePreviewFullScreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isPreviewFullScreen, togglePreviewFullScreen])

  useEffect(() => {
    const cleanup = window.electronAPI.onUpdateAvailable((info: { version: string; url: string }) => {
      setUpdateInfo(info)
    })
    return () => cleanup()
  }, [])

  useEffect(() => {
    window.electronAPI.getPlatform().then(setPlatform)
    initializeSettings()
    const cleanup = window.electronAPI.onProjectOpen(async (payload) => {
      await initializePresets()
      await loadProject(payload)
      useEditorStore.temporal.getState().clear()
    })
    return () => cleanup()
  }, [loadProject, initializePresets, initializeSettings])

  const getPresetButtonContent = () => {
    switch (presetSaveStatus) {
      case 'saving':
        return (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...
          </>
        )
      case 'saved':
        return (
          <>
            <Check className="w-4 h-4 mr-2" /> Saved!
          </>
        )
      default:
        return (
          <>
            <Stack3 className="w-4 h-4 mr-2" /> Presets
          </>
        )
    }
  }

  const renderHeaderActions = () => {
    const isWindows = platform === 'win32'
    const actions = [
      <ExportButton key="export" isExporting={isExporting} onClick={openExportModal} disabled={duration <= 0} />,
      <Button
        key="presets"
        variant="secondary"
        size="sm"
        onClick={() => setPresetModalOpen(true)}
        disabled={presetSaveStatus === 'saving'}
        className={cn(
          'transition-all duration-300 w-[110px] h-8 font-medium shadow-sm',
          presetSaveStatus === 'saved' && 'bg-green-500/15 border border-green-500/30',
          'text-green-600 dark:text-green-400 shadow-green-500/10',
        )}
      >
        {getPresetButtonContent()}
      </Button>,
      <Button
        key="settings"
        variant="ghost"
        size="icon"
        onClick={() => setSettingsModalOpen(true)}
        aria-label="Open Settings"
        className={cn('h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-lg')}
      >
        <Settings className="w-4 h-4" />
      </Button>,
      // Update notification disabled in this fork — checks upstream tamnguyenvan/screenarc
      // releases, which doesn't apply since this is a personal fork. Re-enable by changing
      // the `false` below to `updateInfo` if/when we wire it to check the fork's releases.
      false && updateInfo && <UpdateNotification key="update" info={updateInfo} />,
    ].filter(Boolean)

    if (isWindows) {
      // For Windows, reverse the order
      return actions
    }
    // For macOS/Linux, keep original order but reverse for flex-row-reverse
    return actions.reverse()
  }

  return (
    <main className="h-screen w-screen bg-background flex flex-col overflow-hidden select-none">
      {/*
        Instead of conditionally rendering the entire layout, we now render it once
        and use CSS classes to hide/show elements and expand the preview for fullscreen.
        This prevents components like SidePanel from unmounting, preserving their internal state.
      */}
      <header
        className={cn(
          'relative h-12 flex-shrink-0 border-b border-border/50 bg-card/80 backdrop-blur-xl flex items-center justify-between px-3 shadow-xs',
          isPreviewFullScreen && 'hidden', // Hide header in fullscreen
        )}
        style={{ WebkitAppRegion: 'drag' }}
      >
        {/* Left side controls */}
        <div className="flex items-center gap-4 h-full">
          {platform === 'linux' && (
            <div className="h-full flex items-center">
              <WindowControls />
            </div>
          )}
          {platform === 'win32' && (
            <div
              className="flex items-center gap-2 flex-row-reverse" // Use flex-row-reverse to get desired order
              style={{ WebkitAppRegion: 'no-drag' }}
            >
              {renderHeaderActions()}
            </div>
          )}
        </div>

        {/* Centered Title */}
        <h1 className="text-sm font-bold text-foreground pointer-events-none tracking-tight absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          ScreenArc
        </h1>

        {/* Right side controls (for non-Windows) */}
        {platform !== 'win32' && (
          <div
            className="flex items-center gap-2" // Use flex-row-reverse to get desired order
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            {renderHeaderActions()}
          </div>
        )}
      </header>

      <div className={cn('flex flex-1 overflow-hidden', isPreviewFullScreen && 'h-full w-full')}>
        <div
          className={cn(
            'w-[28rem] flex-shrink-0 bg-sidebar border-r border-sidebar-border overflow-hidden',
            isPreviewFullScreen && 'hidden', // Hide SidePanel in fullscreen
          )}
        >
          <SidePanel />
        </div>
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          <div
            className={cn(
              'flex-1 flex items-center justify-center p-6 overflow-hidden min-h-0',
              // Make the preview container expand to fill the screen in fullscreen mode
              isPreviewFullScreen && 'fixed inset-0 z-50 bg-black p-0',
            )}
          >
            <Preview videoRef={videoRef} onSeekFrame={handleSeekFrame} />
          </div>
          <div className={cn('flex-shrink-0', isPreviewFullScreen && 'hidden')}>
            <PreviewControls />
          </div>
          <div
            className={cn(
              'flex-shrink-0 bg-card/60 border-t border-border/50 backdrop-blur-sm overflow-hidden',
              isPreviewFullScreen && 'hidden', // Hide Timeline in fullscreen
            )}
          >
            <Timeline videoRef={videoRef} />
          </div>
        </div>
      </div>

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={closeExportModal}
        onStartExport={startExport}
        onCancelExport={cancelExport}
        isExporting={isExporting}
        progress={exportProgress}
        result={exportResult}
      />
      <PresetModal isOpen={isPresetModalOpen} onClose={() => setPresetModalOpen(false)} />
      <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setSettingsModalOpen(false)} />
    </main>
  )
}
