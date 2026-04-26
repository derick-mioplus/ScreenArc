/* eslint-disable @typescript-eslint/no-explicit-any */
// Contains core business logic for recording, stopping, and cleanup.

import log from 'electron-log/main'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fsPromises from 'node:fs/promises'
import { app, Menu, Tray, nativeImage, screen, ipcMain, dialog, systemPreferences } from 'electron'
import { appState } from '../state'
import { getFFmpegPath, ensureDirectoryExists } from '../lib/utils'
import { VITE_PUBLIC } from '../lib/constants'
import { createMouseTracker } from './mouse-tracker'
import { getCursorScale, restoreOriginalCursorScale, resetCursorScale } from './cursor-manager'
import { createEditorWindow, cleanupEditorFiles } from '../windows/editor-window'
import { createSavingWindow, createSelectionWindow } from '../windows/temporary-windows'
import type { RecordingSession, RecordingGeometry } from '../state'
import { SystemAudioWriter } from './system-audio-writer'
import { buildMuxArgs } from './build-mux-args'

const FFMPEG_PATH = getFFmpegPath()

// Module-scoped writer used by the renderer-streamed system-audio capture path.
// Lives outside appState because it's a helper, not session data.
const systemAudioWriter = new SystemAudioWriter()

export function getSystemAudioWriter(): SystemAudioWriter {
  return systemAudioWriter
}

/**
 * Uses ffprobe to get the precise creation time of the video file.
 * @param videoPath The path to the video file.
 * @returns A promise that resolves to the creation time as a UNIX timestamp (ms).
 */
async function getVideoStartTime(videoPath: string): Promise<number> {
  try {
    const stats = await fsPromises.stat(videoPath)
    return stats.birthtimeMs
  } catch (error) {
    log.error(`[getVideoStartTime] Error getting file stats for ${videoPath}:`, error)
    throw error
  }
}

/**
 * Validates the generated recording files to ensure they exist and are not empty.
 * @param session - The recording session containing file paths to validate.
 * @returns A promise that resolves to true if files are valid, false otherwise.
 */
async function validateRecordingFiles(session: RecordingSession): Promise<boolean> {
  log.info('[Validation] Validating recorded files...')
  const filesToValidate = [session.screenVideoPath]
  if (session.webcamVideoPath) {
    filesToValidate.push(session.webcamVideoPath)
  }

  for (const filePath of filesToValidate) {
    try {
      const stats = await fsPromises.stat(filePath)
      if (stats.size === 0) {
        const errorMessage = `The recording produced an empty video file (${path.basename(filePath)}). This could be due to incorrect permissions, lack of disk space, or a hardware issue.`
        log.error(`[Validation] ${errorMessage}`)
        dialog.showErrorBox('Recording Validation Failed', errorMessage)
        return false
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const errorMessage = `The recording process failed to create the video file: ${path.basename(filePath)}.`
        log.error(`[Validation] ${errorMessage}`)
        dialog.showErrorBox('Recording Validation Failed', errorMessage)
      } else {
        const errorMessage = `Could not access the recorded file (${path.basename(filePath)}). Error: ${(error as Error).message}`
        log.error(`[Validation] ${errorMessage}`, error)
        dialog.showErrorBox('File Error', errorMessage)
      }
      return false
    }
  }

  log.info('[Validation] All recorded files appear valid (exist and are not empty).')
  return true
}

/**
 * The core function that spawns FFmpeg and the mouse tracker to begin recording.
 * @param inputArgs - Platform-specific FFmpeg input arguments.
 * @param hasWebcam - Flag indicating if webcam recording is enabled.
 * @param hasMic - Flag indicating if microphone recording is enabled.
 * @param hasSystemAudio - Flag indicating if renderer-side system audio capture is enabled.
 * @param recordingGeometry - The logical dimensions and position of the recording area.
 */
async function startActualRecording(
  inputArgs: string[],
  hasWebcam: boolean,
  hasMic: boolean,
  hasSystemAudio: boolean,
  recordingGeometry: RecordingGeometry,
) {
  const recordingDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.screenarc')
  await ensureDirectoryExists(recordingDir)
  const baseName = `ScreenArc-recording-${Date.now()}`

  const screenVideoPath = path.join(recordingDir, `${baseName}-screen.mp4`)
  const webcamVideoPath = hasWebcam ? path.join(recordingDir, `${baseName}-webcam.mp4`) : undefined
  const systemAudioPath = hasSystemAudio ? path.join(recordingDir, `${baseName}-system.webm`) : undefined
  const metadataPath = path.join(recordingDir, `${baseName}.json`)

  // Store recordingGeometry in the session
  appState.currentRecordingSession = {
    screenVideoPath,
    webcamVideoPath,
    systemAudioPath,
    hasMicAudio: hasMic,
    metadataPath,
    recordingGeometry,
  }

  if (systemAudioPath) {
    systemAudioWriter.start(systemAudioPath)
  }

  appState.recorderWin?.minimize()

  // Reset state for the new session
  appState.recordingStartTime = Date.now()
  appState.recordedMouseEvents = []
  appState.runtimeCursorImageMap = new Map()
  appState.mouseTracker = createMouseTracker()

  if (appState.mouseTracker) {
    appState.mouseTracker.on('data', (data: any) => {
      // Check if the mouse event is within the recording geometry bounds
      if (
        data.x >= recordingGeometry.x &&
        data.x <= recordingGeometry.x + recordingGeometry.width &&
        data.y >= recordingGeometry.y &&
        data.y <= recordingGeometry.y + recordingGeometry.height
      ) {
        const absoluteEvent = {
          ...data,
          x: data.x - recordingGeometry.x,
          y: data.y - recordingGeometry.y,
          timestamp: data.timestamp,
        }
        appState.recordedMouseEvents.push(absoluteEvent)
      }
    })
    // Check if tracker started successfully
    const trackerStarted = await appState.mouseTracker.start(appState.runtimeCursorImageMap)
    if (!trackerStarted) {
      log.error('[RecordingManager] Mouse tracker failed to start, likely due to permissions. Aborting recording.')
      appState.recorderWin?.show()
      await cleanupAndDiscard()
      return { canceled: true }
    }
  }

  const finalArgs = buildFfmpegArgs(inputArgs, hasWebcam, hasMic, screenVideoPath, webcamVideoPath)
  log.info(`[FFMPEG] Starting FFmpeg with args: ${finalArgs.join(' ')}`)
  appState.ffmpegProcess = spawn(FFMPEG_PATH, finalArgs)

  // Monitor FFmpeg's stderr for progress, errors, and sync timing
  appState.ffmpegProcess.stderr.on('data', (data: any) => {
    const message = data.toString()
    log.warn(`[FFMPEG stderr]: ${message}`)

    // Early detection of fatal errors to provide immediate feedback
    const fatalErrorKeywords = [
      'Cannot open display',
      'Invalid argument',
      'Device not found',
      'Unknown input format',
      'error opening device',
    ]
    if (fatalErrorKeywords.some((keyword) => message.toLowerCase().includes(keyword.toLowerCase()))) {
      log.error(`[FFMPEG] Fatal error detected: ${message}`)
      dialog.showErrorBox(
        'Recording Failed',
        `A critical error occurred while starting the recording process:\n\n${message}\n\nPlease check your device permissions and configurations.`,
      )
      setTimeout(() => cleanupAndDiscard(), 100)
    }
  })

  // Notify the recorder window that recording has started
  appState.recorderWin?.webContents.send('recording-started')

  createTray()
  return { canceled: false, ...appState.currentRecordingSession }
}

/**
 * Constructs the final FFmpeg command arguments by mapping input streams to output files.
 */
function buildFfmpegArgs(
  inputArgs: string[],
  hasWebcam: boolean,
  hasMic: boolean,
  screenOut: string,
  webcamOut?: string,
): string[] {
  const finalArgs = [...inputArgs]
  // Determine the index of each input stream (mic, webcam, screen)
  const micIndex = hasMic ? 0 : -1
  const webcamIndex = hasMic ? (hasWebcam ? 1 : -1) : hasWebcam ? 0 : -1
  const screenIndex = (hasMic ? 1 : 0) + (hasWebcam ? 1 : 0)

  // Map screen video stream
  finalArgs.push(
    '-map',
    `${screenIndex}:v`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    screenOut,
  )

  // Map audio stream if present - must specify output file (screenOut)
  // Fix for #130: Audio was being routed to webcam file instead of screen file
  if (hasMic) {
    finalArgs.push('-map', `${micIndex}:a`, '-c:a', 'aac', '-b:a', '192k', screenOut)
  }

  // Map webcam video stream if present (video only, no audio)
  if (hasWebcam && webcamOut) {
    finalArgs.push(
      '-map',
      `${webcamIndex}:v`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      webcamOut,
    )
  }

  return finalArgs
}
/**
 * Creates the system tray icon and context menu for controlling an active recording.
 */
function createTray() {
  const icon = nativeImage.createFromPath(path.join(VITE_PUBLIC, 'screenarc-appicon-tray.png'))
  appState.tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Stop Recording',
      click: async () => {
        await stopRecording()
      },
    },
    {
      label: 'Cancel Recording',
      click: async () => {
        await cancelRecording()
      },
    },
  ])
  appState.tray.setToolTip('ScreenArc is recording...')
  appState.tray.setContextMenu(contextMenu)
}

/**
 * Orchestrates the start of a recording based on user options from the renderer.
 * @param options - The recording configuration selected by the user.
 */
export async function startRecording(options: any) {
  const { source, displayId, mic, webcam, systemAudio } = options
  log.info('[RecordingManager] Received start recording request with options:', options)

  // System audio is currently only supported on macOS (uses ScreenCaptureKit /
  // CoreAudio Tap via electron-audio-loopback). Silently drop the flag on
  // other platforms so the rest of the flow stays the same.
  const wantsSystemAudio = !!systemAudio && process.platform === 'darwin'

  // macOS Permissions Check
  if (process.platform === 'darwin') {
    // 1. Check Screen Recording Permissions
    let screenAccess = systemPreferences.getMediaAccessStatus('screen')
    if (screenAccess === 'not-determined') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const iohook = require('iohook-macos')
        const permissions = iohook.checkAccessibilityPermissions()
        screenAccess = permissions.hasPermissions ? 'granted' : 'denied'
      } catch (e) {
        log.error('[MouseTracker] Failed to load macOS-specific modules. Mouse tracking on macOS will be disabled.', e)
      }
    }
    if (screenAccess !== 'granted') {
      dialog.showErrorBox(
        'Screen Recording Permission Required',
        'Accessibility permissions required. Please go to System Preferences > Security & Privacy > Privacy > Accessibility and enable this application.',
      )
      return { canceled: true }
    }

    // 2. Check Microphone Permissions (if requested)
    if (mic) {
      let micAccess = systemPreferences.getMediaAccessStatus('microphone')
      if (micAccess === 'not-determined') {
        micAccess = (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied'
      }
      if (micAccess !== 'granted') {
        dialog.showErrorBox(
          'Microphone Permission Required',
          'Microphone permissions required. Please go to System Preferences > Security & Privacy > Privacy > Microphone and enable this application.',
        )
        return { canceled: true }
      }
    }

    // 3. Heads-up for System Audio capture. The actual TCC prompt is fired by
    // Chromium when the renderer calls getDisplayMedia. We can't pre-flight it
    // here, but we can inform the user that a prompt will appear on first use.
    // CoreAudio Tap permission (macOS 14.4+) is a separate prompt from Screen
    // Recording — it requires NSAudioCaptureUsageDescription in Info.plist.
    if (wantsSystemAudio) {
      log.info('[RecordingManager] System audio capture requested — Chromium will prompt for permission on first getDisplayMedia.')
    }
  }

  const display = process.env.DISPLAY || ':0.0'
  const baseFfmpegArgs: string[] = []
  let recordingGeometry: RecordingGeometry

  // --- Add Microphone and Webcam inputs first ---
  if (mic) {
    switch (process.platform) {
      case 'linux':
        baseFfmpegArgs.push('-f', 'alsa', '-i', 'default')
        break
      case 'win32':
        baseFfmpegArgs.push('-f', 'dshow', '-i', `audio=${mic.deviceLabel}`)
        break
      case 'darwin':
        baseFfmpegArgs.push('-f', 'avfoundation', '-i', `:${mic.index}`)
        break
    }
  }
  if (webcam) {
    switch (process.platform) {
      case 'linux':
        baseFfmpegArgs.push('-f', 'v4l2', '-i', `/dev/video${webcam.index}`)
        break
      case 'win32':
        baseFfmpegArgs.push('-f', 'dshow', '-i', `video=${webcam.deviceLabel}`)
        break
      case 'darwin':
        baseFfmpegArgs.push('-f', 'avfoundation', '-i', `${webcam.index}:none`)
        break
    }
  }

  // --- Add Screen input last ---
  if (source === 'fullscreen') {
    const allDisplays = screen.getAllDisplays()
    const targetDisplay = allDisplays.find((d) => d.id === displayId) || screen.getPrimaryDisplay()
    // Fix for #135: Use scaleFactor to get physical pixel dimensions
    // display.bounds returns screen coordinates (scaled), but FFmpeg needs physical pixels
    const scaleFactor = targetDisplay.scaleFactor
    const x = Math.round(targetDisplay.bounds.x * scaleFactor)
    const y = Math.round(targetDisplay.bounds.y * scaleFactor)
    const width = Math.round(targetDisplay.bounds.width * scaleFactor)
    const height = Math.round(targetDisplay.bounds.height * scaleFactor)
    const safeWidth = Math.floor(width / 2) * 2
    const safeHeight = Math.floor(height / 2) * 2
    recordingGeometry = { x, y, width: safeWidth, height: safeHeight }
    switch (process.platform) {
      case 'linux':
        baseFfmpegArgs.push(
          '-f',
          'x11grab',
          '-draw_mouse',
          '0',
          '-video_size',
          `${safeWidth}x${safeHeight}`,
          '-i',
          `${display}+${x},${y}`,
        )
        break
      case 'win32':
        baseFfmpegArgs.push(
          '-f',
          'gdigrab',
          '-draw_mouse',
          '0',
          '-offset_x',
          x.toString(),
          '-offset_y',
          y.toString(),
          '-video_size',
          `${safeWidth}x${safeHeight}`,
          '-i',
          'desktop',
        )
        break
      case 'darwin':
        baseFfmpegArgs.push(
          '-f',
          'avfoundation',
          '-i',
          `${allDisplays.findIndex((d) => d.id === targetDisplay.id) || 0}:none`,
        )
        break
    }
  } else if (source === 'area') {
    appState.recorderWin?.hide()
    createSelectionWindow()
    const selectedGeometry = await new Promise<any | undefined>((resolve) => {
      ipcMain.once('selection:complete', (_e, geo) => {
        appState.selectionWin?.close()
        resolve(geo)
      })
      ipcMain.once('selection:cancel', () => {
        appState.selectionWin?.close()
        appState.recorderWin?.show()
        resolve(undefined)
      })
    })
    if (!selectedGeometry) return { canceled: true }

    const safeWidth = Math.floor(selectedGeometry.width / 2) * 2
    const safeHeight = Math.floor(selectedGeometry.height / 2) * 2
    recordingGeometry = { x: selectedGeometry.x, y: selectedGeometry.y, width: safeWidth, height: safeHeight }

    switch (process.platform) {
      case 'linux':
        baseFfmpegArgs.push(
          '-f',
          'x11grab',
          '-draw_mouse',
          '0',
          '-video_size',
          `${safeWidth}x${safeHeight}`,
          '-i',
          `${display}+${selectedGeometry.x},${selectedGeometry.y}`,
        )
        break
      case 'win32':
        baseFfmpegArgs.push(
          '-f',
          'gdigrab',
          '-draw_mouse',
          '0',
          '-offset_x',
          selectedGeometry.x.toString(),
          '-offset_y',
          selectedGeometry.y.toString(),
          '-video_size',
          `${safeWidth}x${safeHeight}`,
          '-i',
          'desktop',
        )
        break
    }
  } else {
    return { canceled: true }
  }

  // Only get/store original cursor scale on Linux
  if (process.platform === 'linux') {
    appState.originalCursorScale = await getCursorScale()
  }
  log.info('[RecordingManager] Starting actual recording with args:', baseFfmpegArgs)
  return startActualRecording(baseFfmpegArgs, !!webcam, !!mic, wantsSystemAudio, recordingGeometry)
}

/**
 * Handles the graceful stop of a recording, saves files, validates them, and opens the editor.
 */
export async function stopRecording() {
  restoreOriginalCursorScale()
  log.info('Stopping recording, preparing to save...')
  appState.tray?.destroy()
  appState.tray = null
  createSavingWindow()

  // Tell the renderer to stop its MediaRecorder so any pending chunks land in
  // the writer's queue. The recorder window flushes a final chunk on stop().
  appState.recorderWin?.webContents.send('recorder:stop-system-audio')

  // Step 1: Wait for FFmpeg and tracker to finish
  await cleanupAndSave()
  log.info('FFmpeg process finished and file is finalized.')

  // Step 1b: Flush and finalize the system-audio file (no-op when not used).
  // This must come AFTER cleanupAndSave so any final chunks the renderer
  // emitted in response to 'recorder:stop-system-audio' have time to arrive.
  await systemAudioWriter.finalize()

  const session = appState.currentRecordingSession
  if (!session) {
    log.error('[StopRecord] No recording session found after cleanup. Aborting.')
    appState.savingWin?.close()
    appState.recorderWin?.show()
    return
  }

  // Notify recorder window that the recording has finished, allowing it to reset its UI
  appState.recorderWin?.webContents.send('recording-finished', { canceled: false, ...session })

  // Step 2: Process and save metadata (after video file is complete)
  await processAndSaveMetadata(session)

  // Step 2b: If we captured system audio, mux it into the screen file.
  if (session.systemAudioPath) {
    try {
      await muxSystemAudio(session)
    } catch (err) {
      log.error('[StopRecord] Failed to mux system audio. Keeping original screen file.', err)
      // Non-fatal: leave the original screen file intact and discard the system file.
      await fsPromises.unlink(session.systemAudioPath).catch(() => {})
      session.systemAudioPath = undefined
    }
  }

  // Step 3: Validate file
  const isValid = await validateRecordingFiles(session)
  if (!isValid) {
    log.error('[StopRecord] Recording validation failed. Discarding files.')
    await cleanupEditorFiles(session)
    appState.currentRecordingSession = null
    appState.savingWin?.close()
    resetCursorScale()
    appState.recorderWin?.show()
    return
  }

  await new Promise((resolve) => setTimeout(resolve, 500))
  appState.savingWin?.close()
  resetCursorScale()

  appState.currentRecordingSession = null
  if (session) {
    createEditorWindow(
      session.screenVideoPath,
      session.metadataPath,
      session.recordingGeometry,
      session.webcamVideoPath,
    )
  }
  appState.recorderWin?.close()
}

/**
 * Muxes the renderer-recorded system-audio WebM into the screen file. Replaces
 * `session.screenVideoPath` in place; deletes the system-audio temp file.
 */
async function muxSystemAudio(session: RecordingSession): Promise<void> {
  if (!session.systemAudioPath) return

  // Validate inputs exist and have content. A zero-byte system-audio file
  // means the renderer never delivered chunks (e.g., permission denied) —
  // skip the mux and proceed with the original screen file.
  try {
    const sysStat = await fsPromises.stat(session.systemAudioPath)
    if (sysStat.size === 0) {
      log.warn('[Mux] System audio file is empty; skipping mux.')
      await fsPromises.unlink(session.systemAudioPath).catch(() => {})
      session.systemAudioPath = undefined
      return
    }
  } catch (err) {
    log.warn('[Mux] System audio file missing; skipping mux.', err)
    session.systemAudioPath = undefined
    return
  }

  const tempOutput = session.screenVideoPath.replace(/\.mp4$/, '.muxed.mp4')
  const args = buildMuxArgs({
    screenInput: session.screenVideoPath,
    systemAudioInput: session.systemAudioPath,
    output: tempOutput,
    hasMicAudio: !!session.hasMicAudio,
  })

  log.info(`[Mux] Running ffmpeg ${args.join(' ')}`)

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args)
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg mux exited ${code}: ${stderr.slice(-500)}`))
    })
  })

  // Atomic-ish swap: rename muxed → screen, drop the original screen by virtue
  // of the rename overwriting it. Then drop the system-audio temp file.
  await fsPromises.rename(tempOutput, session.screenVideoPath)
  await fsPromises.unlink(session.systemAudioPath).catch(() => {})
  session.systemAudioPath = undefined
  log.info('[Mux] System audio successfully muxed into screen file.')
}

/**
 * Cancels the recording and discards all associated files and processes.
 */
export async function cancelRecording() {
  log.info('Cancelling recording and deleting files...')
  await cleanupAndDiscard()
  appState.recorderWin?.webContents.send('recording-finished', { canceled: true })
  appState.recorderWin?.show()
}

/**
 * Stops trackers, writes metadata, and gracefully shuts down FFmpeg.
 */
async function cleanupAndSave(): Promise<void> {
  if (appState.mouseTracker) {
    appState.mouseTracker.stop()
    appState.mouseTracker = null
  }

  return new Promise((resolve) => {
    if (appState.ffmpegProcess) {
      const ffmpeg = appState.ffmpegProcess
      appState.ffmpegProcess = null
      ffmpeg.on('close', (code: any) => {
        log.info(`FFmpeg process exited with code ${code}`)
        resolve()
      })
      // Send 'q' for graceful shutdown on Windows, SIGINT on others
      if (process.platform === 'win32') {
        ffmpeg.stdin?.write('q')
        ffmpeg.stdin?.end()
      } else {
        ffmpeg.kill('SIGINT')
      }
    } else {
      resolve()
    }
  })
}

/**
 * Processes mouse events against the final video start time and saves the metadata file.
 * @param session The current recording session.
 * @returns A promise that resolves to true on success, false on failure.
 */
async function processAndSaveMetadata(session: RecordingSession): Promise<boolean> {
  try {
    const videoStartTime = await getVideoStartTime(session.screenVideoPath)
    log.info(`[SYNC] Precise video start time from ffprobe: ${new Date(videoStartTime).toISOString()}`)

    const finalEvents = appState.recordedMouseEvents.map((event) => ({
      ...event,
      timestamp: Math.max(0, event.timestamp - videoStartTime),
    }))

    const primaryDisplay = screen.getPrimaryDisplay()
    const finalMetadata = {
      platform: process.platform,
      screenSize: primaryDisplay.size,
      geometry: session.recordingGeometry,
      syncOffset: 0,
      cursorImages: Object.fromEntries(appState.runtimeCursorImageMap || []),
      events: finalEvents,
    }

    await fsPromises.writeFile(session.metadataPath, JSON.stringify(finalMetadata))
    log.info(`Metadata saved to ${session.metadataPath}`)
    return true
  } catch (err) {
    log.error(`Failed to process and save metadata: ${err}`)
    // Write an empty metadata file to avoid Editor crash
    const errorMetadata = {
      platform: process.platform,
      events: [],
      cursorImages: {},
      geometry: session.recordingGeometry,
      screenSize: screen.getPrimaryDisplay().size,
      syncOffset: 0,
    }
    await fsPromises.writeFile(session.metadataPath, JSON.stringify(errorMetadata))
    return false
  }
}

/**
 * Forcefully terminates all recording processes and deletes any temporary files.
 */
export async function cleanupAndDiscard() {
  if (!appState.currentRecordingSession) return
  log.warn('[Cleanup] Discarding current recording session.')
  const sessionToDiscard = { ...appState.currentRecordingSession }
  appState.currentRecordingSession = null

  appState.ffmpegProcess?.kill('SIGKILL')
  appState.ffmpegProcess = null

  // Tell the renderer to stop its MediaRecorder; even if it ignores us,
  // aborting the writer means subsequent IPC chunks are no-ops.
  appState.recorderWin?.webContents.send('recorder:stop-system-audio')
  await systemAudioWriter.abort()

  appState.mouseTracker?.stop()
  appState.mouseTracker = null

  appState.recordedMouseEvents = []
  appState.runtimeCursorImageMap = new Map()

  restoreOriginalCursorScale()
  appState.tray?.destroy()
  appState.tray = null

  // Asynchronously delete files to not block the UI
  setTimeout(async () => {
    await cleanupEditorFiles(sessionToDiscard)
    if (sessionToDiscard.systemAudioPath) {
      await fsPromises.unlink(sessionToDiscard.systemAudioPath).catch(() => {})
    }
  }, 200)
}

/**
 * Scans the recording directory for leftover files from crashed sessions and deletes them.
 */
export async function cleanupOrphanedRecordings() {
  log.info('[Cleanup] Starting orphaned recording cleanup...')
  const recordingDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.screenarc')
  const protectedFiles = new Set<string>()

  // Protect files from the currently active editor or recording session
  if (appState.currentEditorSessionFiles) {
    Object.values(appState.currentEditorSessionFiles).forEach((file) => file && protectedFiles.add(file))
  }
  if (appState.currentRecordingSession) {
    Object.values(appState.currentRecordingSession).forEach((file) => file && protectedFiles.add(String(file)))
  }

  try {
    const allFiles = await fsPromises.readdir(recordingDir)
    const filePattern = /^ScreenArc-recording-\d+(-screen\.mp4|-screen\.muxed\.mp4|-webcam\.mp4|-system\.webm|\.json)$/
    const filesToDelete = allFiles
      .filter((file) => filePattern.test(file))
      .map((file) => path.join(recordingDir, file))
      .filter((fullPath) => !protectedFiles.has(fullPath))

    if (filesToDelete.length === 0) {
      log.info('[Cleanup] No orphaned files found.')
      return
    }
    log.warn(`[Cleanup] Found ${filesToDelete.length} orphaned files to delete.`)
    for (const filePath of filesToDelete) {
      try {
        await fsPromises.unlink(filePath)
        log.info(`[Cleanup] Deleted orphaned file: ${filePath}`)
      } catch (unlinkError) {
        log.error(`[Cleanup] Failed to delete orphaned file: ${filePath}`, unlinkError)
      }
    }
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error('[Cleanup] Error during orphaned file cleanup:', error)
    }
  }
}

/**
 * Event handler for application quit, ensuring recordings are cleaned up before exit.
 */
export async function onAppQuit(event: Electron.Event) {
  if (appState.currentRecordingSession && !appState.isCleanupInProgress) {
    log.warn('[AppQuit] Active session detected. Cleaning up before exit...')
    event.preventDefault()
    appState.isCleanupInProgress = true
    try {
      await cleanupAndDiscard()
      log.info('[AppQuit] Cleanup finished.')
    } catch (error) {
      log.error('[AppQuit] Error during cleanup:', error)
    } finally {
      app.quit()
    }
  }
}

/**
 * Opens a file dialog to allow the user to import an existing video file for editing.
 */
export async function loadVideoFromFile() {
  log.info('[RecordingManager] Received load video from file request.')
  const recorderWindow = appState.recorderWin
  if (!recorderWindow) return { canceled: true }

  const { canceled, filePaths } = await dialog.showOpenDialog(recorderWindow, {
    title: 'Select a video file to edit',
    properties: ['openFile'],
    filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv'] }],
  })

  if (canceled || filePaths.length === 0) return { canceled: true }

  const sourceVideoPath = filePaths[0]
  log.info(`[RecordingManager] User selected video file: ${sourceVideoPath}`)
  recorderWindow.hide()
  createSavingWindow()

  try {
    const recordingDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.screenarc')
    await ensureDirectoryExists(recordingDir)
    const baseName = `ScreenArc-recording-${Date.now()}`
    const screenVideoPath = path.join(recordingDir, `${baseName}-screen.mp4`)
    const metadataPath = path.join(recordingDir, `${baseName}.json`)

    await fsPromises.copyFile(sourceVideoPath, screenVideoPath)
    await fsPromises.writeFile(
      metadataPath,
      JSON.stringify({
        platform: process.platform,
        events: [],
        cursorImages: {},
        syncOffset: 0,
      }),
      'utf-8',
    )

    // A "fake" geometry is needed for imported videos. It will match the video dimensions.
    const session: RecordingSession = {
      screenVideoPath,
      metadataPath,
      webcamVideoPath: undefined,
      recordingGeometry: { x: 0, y: 0, width: 0, height: 0 },
    }
    const isValid = await validateRecordingFiles(session)
    if (!isValid) {
      await cleanupEditorFiles(session)
      appState.savingWin?.close()
      recorderWindow.show()
      return { canceled: true }
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
    appState.savingWin?.close()
    createEditorWindow(screenVideoPath, metadataPath, session.recordingGeometry, undefined)
    recorderWindow.close()
    return { canceled: false, filePath: screenVideoPath }
  } catch (error) {
    log.error('[RecordingManager] Error loading video from file:', error)
    dialog.showErrorBox('Error Loading Video', `An error occurred while loading the video: ${(error as Error).message}`)
    appState.savingWin?.close()
    if (recorderWindow && !recorderWindow.isDestroyed()) {
      recorderWindow.show()
    }
    return { canceled: true }
  }
}
