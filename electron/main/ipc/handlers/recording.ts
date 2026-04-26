// Handlers for recording-related IPC (recording).

import {
  startRecording,
  loadVideoFromFile,
  stopRecording,
  getSystemAudioWriter,
  markSystemAudioStopped,
} from '../../features/recording-manager'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleStartRecording(_event: any, options: any) {
  return startRecording(options)
}

export function handleLoadVideoFromFile() {
  return loadVideoFromFile()
}

export async function handleStopRecording() {
  await stopRecording()
}

/**
 * Receives a chunk of system-audio data (WebM cluster) from the renderer's
 * MediaRecorder and appends it to the on-disk file. Idempotent across
 * stop/abort: if no active session, the writer silently no-ops.
 */
export async function handleWriteSystemAudioChunk(_event: unknown, chunk: ArrayBuffer): Promise<number> {
  if (!(chunk instanceof ArrayBuffer)) {
    throw new Error('writeSystemAudioChunk: payload must be an ArrayBuffer')
  }
  return getSystemAudioWriter().write(Buffer.from(chunk))
}

export function handleSystemAudioStopped(): void {
  markSystemAudioStopped()
}
