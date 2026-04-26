import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SystemAudioWriter } from './system-audio-writer'

let scratchDir: string

beforeEach(() => {
  scratchDir = mkdtempSync(path.join(tmpdir(), 'screenarc-saw-'))
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

const filePath = () => path.join(scratchDir, 'system.webm')

describe('SystemAudioWriter', () => {
  test('write() before start() is a safe no-op and reports zero bytes', async () => {
    const writer = new SystemAudioWriter()
    const total = await writer.write(Buffer.from([1, 2, 3]))
    expect(total).toBe(0)
  })

  test('start() then write() persists bytes to disk and returns running total', async () => {
    const writer = new SystemAudioWriter()
    writer.start(filePath())

    const first = await writer.write(Buffer.from([1, 2, 3]))
    const second = await writer.write(Buffer.from([4, 5]))

    expect(first).toBe(3)
    expect(second).toBe(5)

    await writer.finalize()
    const onDisk = readFileSync(filePath())
    expect(Array.from(onDisk)).toEqual([1, 2, 3, 4, 5])
  })

  test('concurrent writes are serialized in submission order', async () => {
    const writer = new SystemAudioWriter()
    writer.start(filePath())

    // Submit five writes without awaiting between them
    const writes = [
      writer.write(Buffer.from([0xa])),
      writer.write(Buffer.from([0xb])),
      writer.write(Buffer.from([0xc])),
      writer.write(Buffer.from([0xd])),
      writer.write(Buffer.from([0xe])),
    ]

    const totals = await Promise.all(writes)
    expect(totals).toEqual([1, 2, 3, 4, 5])

    await writer.finalize()
    const onDisk = readFileSync(filePath())
    expect(Array.from(onDisk)).toEqual([0xa, 0xb, 0xc, 0xd, 0xe])
  })

  test('finalize() flushes pending writes before resolving', async () => {
    const writer = new SystemAudioWriter()
    writer.start(filePath())

    writer.write(Buffer.from([1, 2]))
    writer.write(Buffer.from([3, 4]))
    await writer.finalize()

    const onDisk = readFileSync(filePath())
    expect(Array.from(onDisk)).toEqual([1, 2, 3, 4])
  })

  test('write() after finalize() is a safe no-op', async () => {
    const writer = new SystemAudioWriter()
    writer.start(filePath())
    await writer.write(Buffer.from([1]))
    await writer.finalize()

    const total = await writer.write(Buffer.from([2, 3]))
    expect(total).toBe(1)

    const onDisk = readFileSync(filePath())
    expect(Array.from(onDisk)).toEqual([1])
  })

  test('abort() prevents further writes from persisting', async () => {
    const writer = new SystemAudioWriter()
    writer.start(filePath())
    const beforeAbort = await writer.write(Buffer.from([1, 2]))
    await writer.abort()

    const afterAbort = await writer.write(Buffer.from([3, 4]))
    // Bytes counter does not grow after abort; running total stays at the
    // last persisted write. The on-disk file may be partial or empty.
    expect(beforeAbort).toBe(2)
    expect(afterAbort).toBe(2)
  })

  test('start() can begin a fresh session after finalize()', async () => {
    const writer = new SystemAudioWriter()
    const firstPath = path.join(scratchDir, 'a.webm')
    const secondPath = path.join(scratchDir, 'b.webm')

    writer.start(firstPath)
    await writer.write(Buffer.from([0x1, 0x2]))
    await writer.finalize()

    writer.start(secondPath)
    const total = await writer.write(Buffer.from([0x9]))
    await writer.finalize()

    expect(total).toBe(1)
    expect(Array.from(readFileSync(firstPath))).toEqual([1, 2])
    expect(Array.from(readFileSync(secondPath))).toEqual([0x9])
  })

  test('start() creates parent directory if missing', async () => {
    const writer = new SystemAudioWriter()
    const nested = path.join(scratchDir, 'nested', 'deep', 'system.webm')

    writer.start(nested)
    await writer.write(Buffer.from([7]))
    await writer.finalize()

    expect(Array.from(readFileSync(nested))).toEqual([7])
  })
})
