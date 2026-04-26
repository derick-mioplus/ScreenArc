import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts'],
    globals: false,
    testTimeout: 10000,
  },
  resolve: {
    // Stub electron and electron-log/main so plain-Node unit tests don't try to
    // boot the real Electron runtime.
    alias: {
      'electron-log/main': path.resolve(__dirname, 'electron/test/stubs/electron-log-main.ts'),
      'electron-log': path.resolve(__dirname, 'electron/test/stubs/electron-log-main.ts'),
      electron: path.resolve(__dirname, 'electron/test/stubs/electron.ts'),
    },
  },
})
