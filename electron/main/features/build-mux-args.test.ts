import { describe, expect, test } from 'vitest'
import { buildMuxArgs } from './build-mux-args'

const SCREEN = '/tmp/screen.mp4'
const SYS = '/tmp/system.webm'
const OUT = '/tmp/final.mp4'

describe('buildMuxArgs', () => {
  test('mic + system: amix two streams, copy video', () => {
    const args = buildMuxArgs({
      screenInput: SCREEN,
      systemAudioInput: SYS,
      output: OUT,
      hasMicAudio: true,
    })

    expect(args).toEqual([
      '-y',
      '-i', SCREEN,
      '-i', SYS,
      '-filter_complex',
      '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0,aresample=async=1[a]',
      '-map', '0:v',
      '-map', '[a]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      OUT,
    ])
  })

  test('system only: passes system audio straight through', () => {
    const args = buildMuxArgs({
      screenInput: SCREEN,
      systemAudioInput: SYS,
      output: OUT,
      hasMicAudio: false,
    })

    expect(args).toEqual([
      '-y',
      '-i', SCREEN,
      '-i', SYS,
      '-filter_complex',
      '[1:a]aresample=async=1[a]',
      '-map', '0:v',
      '-map', '[a]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      OUT,
    ])
  })

  test('mic only (no system audio): copies streams without filter graph', () => {
    const args = buildMuxArgs({
      screenInput: SCREEN,
      systemAudioInput: undefined,
      output: OUT,
      hasMicAudio: true,
    })

    expect(args).toEqual([
      '-y',
      '-i', SCREEN,
      '-c', 'copy',
      OUT,
    ])
  })

  test('no audio at all: copies streams without filter graph', () => {
    const args = buildMuxArgs({
      screenInput: SCREEN,
      systemAudioInput: undefined,
      output: OUT,
      hasMicAudio: false,
    })

    expect(args).toEqual([
      '-y',
      '-i', SCREEN,
      '-c', 'copy',
      OUT,
    ])
  })

  test('paths with spaces are not pre-quoted (spawn handles them)', () => {
    const args = buildMuxArgs({
      screenInput: '/tmp/with space/screen.mp4',
      systemAudioInput: '/tmp/with space/system.webm',
      output: '/tmp/with space/out.mp4',
      hasMicAudio: false,
    })

    expect(args).toContain('/tmp/with space/screen.mp4')
    expect(args).toContain('/tmp/with space/system.webm')
    expect(args).toContain('/tmp/with space/out.mp4')
    // No bash-style quoting in args
    args.forEach((a) => expect(a).not.toMatch(/^".*"$/))
  })
})
