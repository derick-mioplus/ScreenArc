// Streams system-audio chunks (WebM/Opus) from the renderer to a file on disk.
// Append writes are serialized via a promise queue so concurrent IPC chunks
// never interleave inside the WebM container.

import log from 'electron-log/main'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import path from 'node:path'
import { finished } from 'node:stream/promises'

export class SystemAudioWriter {
  private stream: WriteStream | null = null
  private queue: Promise<void> = Promise.resolve()
  private bytes = 0
  private ended = false
  private failure: Error | null = null
  private detachStreamErrorListener: (() => void) | null = null

  start(filePath: string): void {
    if (this.stream) {
      throw new Error('SystemAudioWriter.start() called while a previous session is still active')
    }

    mkdirSync(path.dirname(filePath), { recursive: true })

    const stream = createWriteStream(filePath, { flags: 'w' })
    const onError = (err: Error) => {
      if (!this.failure) {
        this.failure = err
        log.error('[SystemAudioWriter] Stream error:', err)
      }
    }
    stream.on('error', onError)

    this.stream = stream
    this.detachStreamErrorListener = () => {
      stream.off('error', onError)
    }
    this.queue = Promise.resolve()
    this.bytes = 0
    this.ended = false
    this.failure = null
  }

  async write(chunk: Buffer): Promise<number> {
    if (this.failure) {
      throw this.failure
    }

    const stream = this.stream
    if (!stream || this.ended || stream.writableEnded || stream.destroyed) {
      return this.bytes
    }

    const writeTask = this.queue.then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (this.failure) {
            reject(this.failure)
            return
          }

          if (!this.stream || this.stream !== stream || this.stream.writableEnded || this.stream.destroyed) {
            resolve()
            return
          }

          this.stream.write(chunk, (err) => {
            if (err) {
              const writeError = err instanceof Error ? err : new Error(String(err))
              if (!this.failure) {
                this.failure = writeError
                log.error('[SystemAudioWriter] Write error:', writeError)
              }
              reject(writeError)
              return
            }

            this.bytes += chunk.length
            resolve()
          })
        }),
    )

    this.queue = writeTask
    await writeTask
    return this.bytes
  }

  async finalize(): Promise<void> {
    const stream = this.stream
    if (!stream) return

    this.ended = true
    try {
      await this.queue
      if (this.failure) {
        throw this.failure
      }

      if (!stream.writableEnded && !stream.destroyed) {
        stream.end()
        await finished(stream)
      }
    } catch (error) {
      if (!stream.destroyed) {
        stream.destroy()
        await finished(stream).catch(() => {})
      }
      throw error
    } finally {
      this.reset()
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
      this.reset()
    }
  }

  private reset(): void {
    this.detachStreamErrorListener?.()
    this.detachStreamErrorListener = null
    this.stream = null
  }
}
