/* eslint-disable @typescript-eslint/no-explicit-any */

import log from 'electron-log/main'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const hash = (buffer: Buffer) => createHash('sha1').update(buffer).digest('hex')

let nativeModule: any
const hashToNameMap: Record<string, string> = {}
let isInitialized = false
// Native API stops working ~immediately on Electron 31 (the prebuilt .node is
// built against an older Node-API that returned external buffers, which
// newer V8/Node forbids). Once we see one failure on a hot path, we latch
// this flag and stop hammering the native binding — otherwise we'd log a
// stack trace 60× per second for every recording.
let runtimeUnavailable = false

// These IDs are standard macOS cursor identifiers.
const CURSOR_NAMES = ['arrow', 'IBeam', 'crosshair', 'closedHand', 'openHand', 'pointingHand']

export function initializeMacOSCursorManager() {
  try {
    nativeModule = require('node-macos-cursor')

    for (const name of CURSOR_NAMES) {
      const imageBuffer = nativeModule.getCursorPNGByName(name)
      const imageKey = hash(imageBuffer)
      hashToNameMap[imageKey] = name
    }
    isInitialized = true
    log.info('[MacOSCursorManager] Initialized successfully with macos-cursor-manager and created image map.')
  } catch (e) {
    isInitialized = false
    runtimeUnavailable = true
    log.warn(
      '[MacOSCursorManager] Native module unavailable on this Electron build — cursor-shape detection disabled (defaulting to "arrow"). This is non-fatal; cursor position tracking still works.',
      e instanceof Error ? e.message : e,
    )
  }
}

export function getCurrentCursorName(): string {
  if (!isInitialized || runtimeUnavailable) return 'arrow'
  try {
    const imageBuffer = nativeModule.getCurrentCursorPNG()
    const imageKey = hash(imageBuffer)
    return hashToNameMap[imageKey] || 'arrow'
  } catch (e) {
    // Latch the failure so we don't spam the log on every poll. The first
    // error message is preserved; subsequent polls just return 'arrow'.
    if (!runtimeUnavailable) {
      runtimeUnavailable = true
      log.warn(
        '[MacOSCursorManager] Native cursor lookup failed; latching off for the rest of this session:',
        e instanceof Error ? e.message : e,
      )
    }
    return 'arrow'
  }
}
