// Streams system-audio chunks (WebM/Opus) from the renderer to a file on disk.
// Append writes are serialized via a promise queue so concurrent IPC chunks
// never interleave inside the WebM container.

import log from 'electron-log/main'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import path from 'node:path'

export class SystemAudioWriter {
  private stream: WriteStream | null = null
  private queue: Promise<void> = Promise.resolve()
  private bytes = 0
  private ended = false

  start(filePath: string): void {
    mkdirSync(path.dirname(filePath), { recursive: true })

    this.stream = createWriteStream(filePath, { flags: 'w' })
    this.queue = Promise.resolve()
    this.bytes = 0
    this.ended = false
  }

  async write(chunk: Buffer): Promise<number> {
    const stream = this.stream
    if (!stream || this.ended || stream.writableEnded) {
      return this.bytes
    }

    this.queue = this.queue
      .catch(() => {
        // Swallow earlier errors so subsequent chunks still attempt to flush.
      })
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            if (!this.stream || this.stream.writableEnded) {
              resolve()
              return
            }
            this.stream.write(chunk, (err) => {
              if (err) {
                log.error('[SystemAudioWriter] Write error:', err)
                reject(err)
                return
              }
              this.bytes += chunk.length
              resolve()
            })
          }),
      )

    try {
      await this.queue
    } catch {
      // Errors are logged above; the writer remains in a consistent state.
    }
    return this.bytes
  }

  async finalize(): Promise<void> {
    const stream = this.stream
    if (!stream) return

    this.ended = true
    try {
      await this.queue.catch(() => {})
      if (!stream.writableEnded) {
        await new Promise<void>((resolve) => stream.end(() => resolve()))
      }
    } finally {
      this.stream = null
    }
  }

  async abort(): Promise<void> {
    const stream = this.stream
    if (!stream) return

    this.ended = true
    try {
      stream.destroy()
      await this.queue.catch(() => {})
    } finally {
      this.stream = null
    }
  }
}
