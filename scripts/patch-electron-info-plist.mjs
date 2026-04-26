#!/usr/bin/env node
// Patches the dev Electron binary's Info.plist with the macOS TCC usage
// description keys ScreenArc relies on, then ad-hoc re-signs the bundle.
//
// Why this exists:
// - On macOS, an app only appears in System Settings → Privacy & Security
//   when it both declares the matching NSXxxxUsageDescription string in its
//   Info.plist *and* invokes the corresponding Apple API at runtime.
// - The Electron dev binary in node_modules/electron does NOT include
//   NSScreenCaptureUsageDescription out of the box. Without it, macOS
//   silently denies Screen Recording, and the dev build never appears in
//   Privacy & Security at all.
// - This script runs as part of `npm install`'s postinstall so the keys are
//   re-applied after every dependency install / Electron upgrade.
//
// Side effects:
// - Modifies node_modules/electron/dist/Electron.app/Contents/Info.plist
// - Ad-hoc re-signs the .app bundle so macOS will load it after the change
// - Idempotent: running it twice is safe (uses plutil -replace fall-through)
//
// Non-macOS platforms are skipped silently. Errors are logged but don't fail
// `npm install` because users on Linux/Windows shouldn't be blocked.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const log = (...args) => console.log('[patch-electron-info-plist]', ...args)
const warn = (...args) => console.warn('[patch-electron-info-plist]', ...args)

if (process.platform !== 'darwin') {
  log(`Skipping on ${process.platform} (only meaningful on macOS).`)
  process.exit(0)
}

const electronAppPath = path.join(
  process.cwd(),
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
)
const plistPath = path.join(electronAppPath, 'Contents', 'Info.plist')

if (!existsSync(plistPath)) {
  warn(`Electron Info.plist not found at ${plistPath} — skipping. Run \`npm install\` first.`)
  process.exit(0)
}

log(`Patching ${plistPath}`)

// Strings the user will see in the macOS permission prompts. Match the
// production build's `extendInfo` in package.json so the dev and packaged
// builds behave identically.
const usageStrings = {
  NSScreenCaptureUsageDescription:
    "ScreenArc needs to record your computer's screen to capture video.",
  NSAudioCaptureUsageDescription:
    'ScreenArc captures system audio so you can include it in your screen recordings.',
  NSMicrophoneUsageDescription:
    'ScreenArc records from the microphone when you enable it during a recording.',
  NSCameraUsageDescription:
    'ScreenArc accesses the camera when you enable webcam capture during a recording.',
}

// Identity overrides. Out of the box the dev Electron binary identifies
// itself as `Electron` with bundle id `com.github.Electron`, so it either
// (a) doesn't appear at all in System Settings → Privacy & Security under a
// recognizable name, or (b) collides with every other Electron-based dev
// tool the user has run. We rename it to "ScreenArc Dev" and give it a
// project-specific bundle id so it shows up as its own entry — this lets
// the user revoke or grant Screen Recording / Microphone independently.
//
// Note: changing the bundle id means any prior TCC grant (under
// `com.github.Electron`) does NOT carry over. The user re-grants once.
const identityOverrides = {
  CFBundleIdentifier: 'com.screenarc.dev',
  CFBundleName: 'ScreenArc Dev',
  CFBundleDisplayName: 'ScreenArc Dev',
  CFBundleExecutable: 'Electron',
}

for (const [key, value] of Object.entries({ ...usageStrings, ...identityOverrides })) {
  // Try -replace first; if the key doesn't exist yet, fall back to -insert.
  // Both are idempotent in their respective branches.
  try {
    execFileSync('plutil', ['-replace', key, '-string', value, plistPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    log(`  replaced ${key}`)
  } catch {
    try {
      execFileSync('plutil', ['-insert', key, '-string', value, plistPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      log(`  inserted ${key}`)
    } catch (err) {
      warn(`  failed to set ${key}:`, err?.message ?? err)
    }
  }
}

// Ad-hoc resign so the kernel doesn't reject the modified bundle.
// Without this, macOS may load the old signed-but-stale Info.plist or refuse
// to launch the binary. `--force --deep --sign -` is the standard
// development incantation.
try {
  log('Re-signing Electron.app (ad-hoc) so macOS accepts the modified Info.plist...')
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', electronAppPath], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  log('Re-signing complete.')
} catch (err) {
  warn('codesign failed — the dev Electron binary may not show in Privacy & Security:')
  warn(err?.message ?? err)
}

log('Done. ScreenArc dev build should now register with macOS TCC on next launch.')
