import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// Native modules that need to be externalized for proper runtime loading
// Fix for #137: global-mouse-events not loading on Windows
const nativeModules = ['global-mouse-events', 'iohook-macos', 'node-macos-cursor', 'node-win-cursor', 'x11']

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    tailwindcss(),
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main/index.ts',
        // Fix for ESM/CommonJS issue on macOS (#138, #131)
        // Output as .cjs to avoid "exports is not defined" error
        // when package.json has "type": "module"
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                entryFileNames: '[name].cjs',
              },
              // Fix for #137: Externalize native modules
              // These modules need to be loaded at runtime, not bundled
              external: nativeModules,
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
        // Fix for ESM/CommonJS issue on macOS (#138, #131)
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                entryFileNames: '[name].cjs',
              },
            },
          },
        },
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      // renderer: process.env.NODE_ENV === 'test'
      // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
      // ? undefined
      // : {},
    }),
    nodePolyfills(), // this is necessary to avoid "Buffer is not defined issue"
  ],
})
