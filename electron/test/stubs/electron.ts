// Test stub: minimal surface of the electron module so plain-Node imports don't fail.
// Tests that need real Electron behavior should mock this themselves.

export const app = {
  isPackaged: false,
  getPath: () => '/tmp',
  getVersion: () => '0.0.0-test',
  quit: () => {},
  on: () => {},
  whenReady: () => Promise.resolve(),
}

export const ipcMain = {
  on: () => {},
  handle: () => {},
  removeAllListeners: () => {},
  once: () => {},
}

export const BrowserWindow = class {}
export const Tray = class {}
export const Menu = { buildFromTemplate: () => ({}), setApplicationMenu: () => {} }
export const dialog = {
  showErrorBox: () => {},
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
  showSaveDialog: () => Promise.resolve({ canceled: true, filePath: undefined }),
}
export const screen = {
  getAllDisplays: () => [],
  getPrimaryDisplay: () => ({ id: 0, bounds: { x: 0, y: 0, width: 0, height: 0 }, scaleFactor: 1, size: { width: 0, height: 0 } }),
}
export const systemPreferences = {
  getMediaAccessStatus: () => 'granted',
  askForMediaAccess: () => Promise.resolve(true),
}
export const nativeImage = { createFromPath: () => ({}) }
export const session = {
  defaultSession: {
    setDisplayMediaRequestHandler: () => {},
  },
}
