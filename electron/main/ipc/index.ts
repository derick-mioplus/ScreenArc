import { ipcMain } from 'electron'
import * as appHandlers from './handlers/app'
import * as desktopHandlers from './handlers/desktop'
import * as exportHandlers from './handlers/export'
import * as fsHandlers from './handlers/file-system'
import * as recordingHandlers from './handlers/recording'
import * as settingsHandlers from './handlers/settings'
import * as shellHandlers from './handlers/shell'

export function registerIpcHandlers() {
  // App & Window
  ipcMain.handle('app:getPath', appHandlers.handleGetPath)
  ipcMain.handle('app:getVersion', appHandlers.handleGetVersion)
  ipcMain.handle('app:getPlatform', appHandlers.handleGetPlatform)
  ipcMain.on('window:minimize', appHandlers.minimizeWindow)
  ipcMain.on('window:maximize', appHandlers.maximizeWindow)
  ipcMain.on('window:close', appHandlers.closeWindow)
  ipcMain.handle('window:isMaximized', appHandlers.handleIsMaximized)
  ipcMain.on('window:update-title-bar-overlay', appHandlers.updateTitleBarOverlay)

  // Desktop
  ipcMain.handle('desktop:get-displays', desktopHandlers.getDisplays)
  ipcMain.handle('desktop:get-dshow-devices', desktopHandlers.getDshowDevices)
  ipcMain.handle('desktop:get-cursor-scale', desktopHandlers.handleGetCursorScale)
  ipcMain.on('desktop:set-cursor-scale', desktopHandlers.handleSetCursorScale)
  ipcMain.handle('dialog:showSaveDialog', desktopHandlers.showSaveDialog)
  ipcMain.handle('video:get-frame', desktopHandlers.getVideoFrame)

  ipcMain.handle('desktop:get-cursor-themes', desktopHandlers.getCursorThemes)
  ipcMain.handle('desktop:load-cursor-theme', desktopHandlers.loadCursorTheme)
  ipcMain.handle('desktop:map-cursor-name-to-idc', desktopHandlers.handleMapCursorNameToIDC)

  // Recording
  ipcMain.handle('recording:start', recordingHandlers.handleStartRecording)
  ipcMain.on('recording:stop', recordingHandlers.handleStopRecording)
  ipcMain.handle('recording:load-from-file', recordingHandlers.handleLoadVideoFromFile)
  ipcMain.handle('recording:write-system-audio', recordingHandlers.handleWriteSystemAudioChunk)

  // Export
  ipcMain.handle('export:start', exportHandlers.handleStartExport)

  // File System
  ipcMain.handle('fs:readFile', fsHandlers.handleReadFile)

  // Settings & Presets
  ipcMain.handle('presets:load', settingsHandlers.loadPresets)
  ipcMain.handle('presets:save', settingsHandlers.savePresets)
  ipcMain.handle('settings:get', settingsHandlers.getSetting)
  ipcMain.on('settings:set', settingsHandlers.setSetting)

  // Shell
  ipcMain.on('shell:showItemInFolder', shellHandlers.showItemInFolder)
  ipcMain.on('shell:openExternal', shellHandlers.openExternal)
}
