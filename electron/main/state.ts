/* eslint-disable @typescript-eslint/no-explicit-any */
// Manages global application state in a centralized way.

import { BrowserWindow, Tray } from 'electron'
import { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { IMouseTracker } from './features/mouse-tracker'

// ADDED: Define RecordingGeometry type here for better reusability
export interface RecordingGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface RecordingSession {
  screenVideoPath: string
  metadataPath: string
  webcamVideoPath?: string
  // Set when system-audio capture (renderer-side MediaRecorder) is enabled.
  // Cleared after the post-recording mux merges it into the screen file.
  systemAudioPath?: string
  // True when mic capture is enabled for this session. Drives mux filter graph.
  hasMicAudio?: boolean
  recordingGeometry: RecordingGeometry
}

interface AppState {
  // Windows
  recorderWin: BrowserWindow | null
  editorWin: BrowserWindow | null
  renderWorker: BrowserWindow | null
  savingWin: BrowserWindow | null
  selectionWin: BrowserWindow | null

  // System
  tray: Tray | null

  // Processes & Streams
  ffmpegProcess: ChildProcessWithoutNullStreams | null
  mouseTracker: IMouseTracker | null

  // In-memory recording data
  recordedMouseEvents: any[]
  runtimeCursorImageMap: Map<string, any>

  // Recording State
  recordingStartTime: number
  originalCursorScale: number | null
  currentRecordingSession: RecordingSession | null
  currentEditorSessionFiles: RecordingSession | null

  // Flags
  isCleanupInProgress: boolean
}

export const appState: AppState = {
  recorderWin: null,
  editorWin: null,
  renderWorker: null,
  savingWin: null,
  selectionWin: null,
  tray: null,
  ffmpegProcess: null,
  mouseTracker: null,
  recordedMouseEvents: [],
  runtimeCursorImageMap: new Map(),
  recordingStartTime: 0,
  originalCursorScale: null,
  currentRecordingSession: null,
  currentEditorSessionFiles: null,
  isCleanupInProgress: false,
}
