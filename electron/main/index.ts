// Entry point of the Electron application.

import { app, BrowserWindow, protocol, ProtocolRequest, ProtocolResponse, Menu, screen, dialog, desktopCapturer, systemPreferences, shell } from 'electron'
import { initMain as initAudioLoopback } from 'electron-audio-loopback'
import log from 'electron-log/main'
import path from 'node:path'
import fsSync from 'node:fs'
import { VITE_PUBLIC } from './lib/constants'
import { setupLogging } from './lib/logging'
import { registerIpcHandlers } from './ipc'
import { createRecorderWindow } from './windows/recorder-window'
import { onAppQuit, startRecording, loadVideoFromFile } from './features/recording-manager'
import { initializeMouseTrackerDependencies } from './features/mouse-tracker'
import { appState } from './state'

// --- Initialization ---
setupLogging()

// Enable system audio loopback capture on macOS (12.3+ via ScreenCaptureKit,
// 14.4+ via CoreAudio Taps with `forceCoreAudioTap: true`). Must run before
// `app.whenReady()` because it appends Chromium feature flags.
// See: https://github.com/alectrocute/electron-audio-loopback
initAudioLoopback({ forceCoreAudioTap: true })

// --- App Lifecycle Events ---
app.on('window-all-closed', () => {
  log.info('[App] All windows closed. Quitting.')
  app.quit()
})

app.on('before-quit', onAppQuit)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createRecorderWindow()
  }
})

app.whenReady().then(async () => {
  log.info('[App] Ready. Initializing...')

  // Set Dock Menu on macOS
  if (process.platform === 'darwin') {
    const dockMenu = Menu.buildFromTemplate([
      {
        label: 'New Default Recording',
        click: () => {
          if (appState.editorWin && !appState.editorWin.isDestroyed()) {
            dialog.showErrorBox(
              'Action Not Allowed',
              'Please close the current editor session to start a new recording.',
            )
            appState.editorWin.focus()
            return
          }
          if (appState.currentRecordingSession) {
            dialog.showErrorBox('Recording in Progress', 'A recording is already in progress.')
            return
          }

          if (!appState.recorderWin || appState.recorderWin.isDestroyed()) {
            createRecorderWindow()
          }
          appState.recorderWin?.show()

          const primaryDisplay = screen.getPrimaryDisplay()
          startRecording({
            source: 'fullscreen',
            displayId: primaryDisplay.id,
            mic: undefined,
            webcam: undefined,
          })
        },
      },
      {
        label: 'Import Video File...',
        click: () => {
          if (appState.editorWin && !appState.editorWin.isDestroyed()) {
            dialog.showErrorBox('Action Not Allowed', 'Please close the current editor session to import a new video.')
            appState.editorWin.focus()
            return
          }
          if (appState.currentRecordingSession) {
            dialog.showErrorBox('Recording in Progress', 'A recording is already in progress.')
            return
          }

          if (!appState.recorderWin || appState.recorderWin.isDestroyed()) {
            createRecorderWindow()
          }
          appState.recorderWin?.show()
          loadVideoFromFile()
        },
      },
    ])
    app.dock.setMenu(dockMenu)
  }

  // Initialize platform-specific dependencies asynchronously
  initializeMouseTrackerDependencies()

  // Proactively register this app with macOS Screen Recording TCC so it
  // appears in System Settings → Privacy & Security → Screen Recording.
  // This must run after the window is ready.
  if (process.platform === 'darwin') {
    desktopCapturer.getSources({ types: ['screen'] }).catch((e) => {
      log.warn('[Permission] desktopCapturer.getSources failed at startup:', e)
    })
  }

  // Register custom protocol for media files
  protocol.registerFileProtocol(
    'media',
    (request: ProtocolRequest, callback: (response: string | ProtocolResponse) => void) => {
      const url = request.url.replace('media://', '')
      const decodedUrl = decodeURIComponent(url)
      const resourcePath = path.join(VITE_PUBLIC, decodedUrl)

      if (path.isAbsolute(decodedUrl) && fsSync.existsSync(decodedUrl)) {
        return callback(decodedUrl)
      }
      if (fsSync.existsSync(resourcePath)) {
        return callback(resourcePath)
      }
      log.error(`[Protocol] Could not find file: ${decodedUrl}`)
      return callback({ error: -6 }) // FILE_NOT_FOUND
    },
  )

  registerIpcHandlers()
  createRecorderWindow()
})
