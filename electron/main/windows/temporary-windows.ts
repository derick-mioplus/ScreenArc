// Logic to create temporary windows like countdown, saving, selection.

import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { appState } from '../state'
import { VITE_DEV_SERVER_URL, RENDERER_DIST, PRELOAD_SCRIPT } from '../lib/constants'

function createTemporaryWindow(options: Electron.BrowserWindowConstructorOptions, htmlPath: string) {
  // Define the path to the icon, handling both development and production environments
  const iconPath = VITE_DEV_SERVER_URL
    ? path.join(process.env.APP_ROOT!, 'public/screenarc-appicon.png')
    : path.join(RENDERER_DIST, 'screenarc-appicon.png')

  const win = new BrowserWindow({
    ...options,
    icon: iconPath, // Set the window icon here
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      preload: PRELOAD_SCRIPT,
      contextIsolation: false,
    },
  })

  const url = VITE_DEV_SERVER_URL
    ? path.join(process.env.APP_ROOT!, `public/${htmlPath}`)
    : path.join(RENDERER_DIST, htmlPath)

  win.loadFile(url)
  return win
}

export function createSavingWindow() {
  appState.savingWin = createTemporaryWindow({ width: 350, height: 200, show: false }, 'saving/index.html')

  // Only show the window once it's ready to avoid a white flash
  appState.savingWin.once('ready-to-show', () => {
    appState.savingWin?.show()
  })

  appState.savingWin.on('closed', () => {
    appState.savingWin = null
  })
}

export function createSelectionWindow() {
  appState.selectionWin = createTemporaryWindow({ fullscreen: true }, 'selection/index.html')

  appState.selectionWin.on('closed', () => {
    appState.selectionWin = null
  })
}

// A small always-on-top "● REC + elapsed time + Stop" control shown during
// recording, so the user always has a visible, reachable way to stop without
// hunting for the tray icon.
export function createStopControlWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize
  const windowWidth = 196
  const windowHeight = 52
  const x = Math.round((screenWidth - windowWidth) / 2)
  const y = 24

  appState.stopControlWin = createTemporaryWindow(
    { width: windowWidth, height: windowHeight, x, y, show: false, focusable: false, skipTaskbar: true },
    'stop-control/index.html',
  )

  // Visible to the user but excluded from screen capture (FFmpeg/gdigrab), so the
  // control never appears in the recording. The rest of the app avoids capture by
  // hiding the recorder window; this control must stay on-screen, so it relies on
  // content protection instead. (focusable:false so it never steals focus from the
  // app being recorded.)
  appState.stopControlWin.setContentProtection(true)

  appState.stopControlWin.once('ready-to-show', () => {
    appState.stopControlWin?.show()
  })

  appState.stopControlWin.on('closed', () => {
    appState.stopControlWin = null
  })
}

export function closeStopControlWindow() {
  if (appState.stopControlWin && !appState.stopControlWin.isDestroyed()) {
    appState.stopControlWin.close()
  }
  appState.stopControlWin = null
}
