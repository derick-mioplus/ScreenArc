/* eslint-disable @typescript-eslint/no-explicit-any */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

// Define the type for the callback value
type RecordingResult = {
  canceled: boolean
  filePath: string | undefined
}

type ProjectPayload = {
  videoPath: string
  metadataPath: string
  webcamVideoPath?: string
}

type ExportPayload = {
  projectState: any
  exportSettings: any
  outputPath: string
}
// Payload received from process
type ProgressPayload = {
  progress: number // 0-100
  stage: string
}
// Payload when completed
type CompletePayload = {
  success: boolean
  outputPath?: string
  error?: string
}

// Payload for worker render
type RenderStartPayload = {
  projectState: any
  exportSettings: any
}

type WindowSource = {
  id: string
  name: string
  thumbnailUrl: string
  geometry?: {
    x: number
    y: number
    width: number
    height: number
  }
}

// --- Presets ---
type Preset = any

type DisplayInfo = {
  id: number
  name: string
  bounds: { x: number; y: number; width: number; height: number }
  isPrimary: boolean
}

// --- Update ---
type UpdateInfo = {
  version: string
  url: string
}

// --- Dshow Devices ---
type DshowDevice = {
  name: string
  alternativeName: string
}

// --- Cursor Theme ---
type CursorTheme = any

// Define API to be exposed to window object
export const electronAPI = {
  // --- Recording ---
  startRecording: (options: {
    source: 'area' | 'fullscreen' | 'window'
    geometry?: WindowSource['geometry']
    windowTitle?: string
    displayId?: number
    webcam?: { deviceId: string; deviceLabel: string; index: number }
    mic?: { deviceId: string; deviceLabel: string; index: number }
    systemAudio?: boolean
  }): Promise<RecordingResult> => ipcRenderer.invoke('recording:start', options),
  stopRecording: (): void => ipcRenderer.send('recording:stop'),
  loadVideoFromFile: (): Promise<RecordingResult> => ipcRenderer.invoke('recording:load-from-file'),
  getCursorScale: (): Promise<number> => ipcRenderer.invoke('desktop:get-cursor-scale'),
  setCursorScale: (scale: number): void => ipcRenderer.send('desktop:set-cursor-scale', scale),

  // --- System Audio Loopback (macOS) ---
  // electron-audio-loopback registers `enable-loopback-audio` and
  // `disable-loopback-audio` IPC handlers in initMain(). Wrap each
  // getDisplayMedia call between enable/disable so Chromium returns a
  // system-audio track instead of microphone audio.
  enableLoopbackAudio: (): Promise<void> => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: (): Promise<void> => ipcRenderer.invoke('disable-loopback-audio'),
  writeSystemAudioChunk: (chunk: ArrayBuffer): Promise<number> =>
    ipcRenderer.invoke('recording:write-system-audio', chunk),
  onStopSystemAudio: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('recorder:stop-system-audio', listener)
    return () => ipcRenderer.removeListener('recorder:stop-system-audio', listener)
  },

  getDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('desktop:get-displays'),
  getDshowDevices: (): Promise<{ video: DshowDevice[]; audio: DshowDevice[] }> =>
    ipcRenderer.invoke('desktop:get-dshow-devices'),

  onRecordingStarted: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('recording-started', listener)
    return () => {
      ipcRenderer.removeListener('recording-started', listener)
    }
  },

  onRecordingFinished: (callback: (result: RecordingResult) => void) => {
    const listener = (_event: IpcRendererEvent, result: RecordingResult) => callback(result)
    ipcRenderer.on('recording-finished', listener)

    return () => {
      ipcRenderer.removeListener('recording-finished', listener)
    }
  },
  onReleaseWebcamRequest: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('recorder:release-webcam', listener)
    return () => ipcRenderer.removeListener('recorder:release-webcam', listener)
  },
  sendWebcamReleasedConfirmation: () => ipcRenderer.send('recorder:webcam-released'),

  // --- Editor window ---
  onProjectOpen: (callback: (payload: ProjectPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: ProjectPayload) => callback(payload)
    ipcRenderer.on('project:open', listener)

    return () => {
      ipcRenderer.removeListener('project:open', listener)
    }
  },

  readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:readFile', filePath),

  // --- Export ---
  startExport: (payload: ExportPayload): Promise<void> => ipcRenderer.invoke('export:start', payload),
  cancelExport: (): void => ipcRenderer.send('export:cancel'),

  onExportProgress: (callback: (payload: ProgressPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: ProgressPayload) => callback(payload)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },

  onExportComplete: (callback: (payload: CompletePayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: CompletePayload) => callback(payload)
    ipcRenderer.on('export:complete', listener)
    return () => ipcRenderer.removeListener('export:complete', listener)
  },

  showSaveDialog: (options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> => {
    return ipcRenderer.invoke('dialog:showSaveDialog', options)
  },

  showItemInFolder: (path: string): void => ipcRenderer.send('shell:showItemInFolder', path),

  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => {
    const listener = (_event: IpcRendererEvent, info: UpdateInfo) => callback(info)
    ipcRenderer.on('update:available', listener)
    return () => {
      ipcRenderer.removeListener('update:available', listener)
    }
  },
  openExternal: (url: string): void => ipcRenderer.send('shell:openExternal', url),

  // --- Render Worker ---
  onRenderStart: (callback: (payload: RenderStartPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: RenderStartPayload) => callback(payload)
    ipcRenderer.on('render:start', listener)
    return () => ipcRenderer.removeListener('render:start', listener)
  },
  rendererReady: () => {
    ipcRenderer.send('render:ready')
  },
  sendFrameToMain: (payload: { frame: Buffer; progress: number }) => {
    ipcRenderer.send('export:frame-data', payload)
  },
  finishRender: () => {
    ipcRenderer.send('export:render-finished')
  },

  // --- Presets & Settings ---
  loadPresets: (): Promise<Record<string, Preset>> => ipcRenderer.invoke('presets:load'),
  savePresets: (presets: Record<string, Preset>): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('presets:save', presets),
  getSetting: <T = any>(key: string): Promise<T> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: unknown): void => ipcRenderer.send('settings:set', key, value),
  getPath: (name: 'home' | 'userData' | 'desktop'): Promise<string> => ipcRenderer.invoke('app:getPath', name),
  getCursorThemes: (): Promise<string[]> => ipcRenderer.invoke('desktop:get-cursor-themes'),
  loadCursorTheme: (themeName?: string): Promise<CursorTheme | null> =>
    ipcRenderer.invoke('desktop:load-cursor-theme', themeName),
  mapCursorNameToIDC: (name: string): Promise<string> => ipcRenderer.invoke('desktop:map-cursor-name-to-idc', name),

  // --- Window Controls ---
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  recorderClickThrough: () => ipcRenderer.send('recorder:click-through'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  onWindowStateChange: (callback: (payload: { isMaximized: boolean }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { isMaximized: boolean }) => callback(payload)
    ipcRenderer.on('window:state-changed', listener)
    return () => {
      ipcRenderer.removeListener('window:state-changed', listener)
    }
  },
  // --- START OF CHANGES ---
  updateTitleBarOverlay: (options: { color: string; symbolColor: string }) => {
    ipcRenderer.send('window:update-title-bar-overlay', options)
  },
  // --- END OF CHANGES ---
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  getPlatform: (): Promise<NodeJS.Platform> => ipcRenderer.invoke('app:getPlatform'),
  getVideoFrame: (options: { videoPath: string; time: number }): Promise<string> =>
    ipcRenderer.invoke('video:get-frame', options),
}

// Expose API safely
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Also need to define types for TypeScript in renderer
declare global {
  interface Window {
    electronAPI: typeof electronAPI
  }
}
