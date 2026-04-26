import { describe, expect, test } from 'vitest'
import { buildMuxArgs, buildMacMuxArgs } from './build-mux-args'

const SCREEN = '/tmp/screen.mp4'
const SYS = '/tmp/system.webm'
const OUT = '/tmp/final.mp4'
const WEBM = '/tmp/screen.webm'
const MIC = '/tmp/mic.m4a'

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

describe('buildMacMuxArgs', () => {
  test('webm with system audio + mic: amix two streams, transcode video', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: MIC,
      output: OUT,
      webmHasSystemAudio: true,
    })

    expect(args).toEqual([
      '-y',
      '-i', WEBM,
      '-i', MIC,
      '-filter_complex',
      '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0,aresample=async=1[a]',
      '-map', '0:v',
      '-map', '[a]',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      OUT,
    ])
  })

  test('webm with system audio only: aresample audio, transcode video', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: undefined,
      output: OUT,
      webmHasSystemAudio: true,
    })

    expect(args).toEqual([
      '-y',
      '-i', WEBM,
      '-filter_complex',
      '[0:a]aresample=async=1[a]',
      '-map', '0:v',
      '-map', '[a]',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      OUT,
    ])
  })

  test('mic only (no system audio in webm): copy mic stream, transcode video', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: MIC,
      output: OUT,
      webmHasSystemAudio: false,
    })

    expect(args).toEqual([
      '-y',
      '-i', WEBM,
      '-i', MIC,
      '-map', '0:v',
      '-map', '1:a',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      '-shortest',
      OUT,
    ])
  })

  test('no audio at all: video-only output with -an', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: undefined,
      output: OUT,
      webmHasSystemAudio: false,
    })

    expect(args).toEqual([
      '-y',
      '-i', WEBM,
      '-map', '0:v',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-an',
      OUT,
    ])
  })

  test('paths with spaces are not pre-quoted (spawn handles them)', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: '/tmp/with space/screen.webm',
      micAudioInput: '/tmp/with space/mic.m4a',
      output: '/tmp/with space/out.mp4',
      webmHasSystemAudio: true,
    })

    expect(args).toContain('/tmp/with space/screen.webm')
    expect(args).toContain('/tmp/with space/mic.m4a')
    expect(args).toContain('/tmp/with space/out.mp4')
    args.forEach((a) => expect(a).not.toMatch(/^".*"$/))
  })
})
