// Builds FFmpeg arguments for the post-recording mux step that combines the
// screen-capture file with an optional renderer-recorded system-audio WebM.
//
// Layout:
//   input 0: screen capture (mp4) — may already contain mic audio
//   input 1: system audio (webm/opus) — optional
//
// When both mic and system audio are present, they are mixed via amix.
// When only system audio is present, it is mapped through aresample for
// drift correction. When neither extra audio applies, we just stream-copy.

export interface BuildMuxArgsOptions {
  screenInput: string
  systemAudioInput: string | undefined
  output: string
  hasMicAudio: boolean
}

export function buildMuxArgs(opts: BuildMuxArgsOptions): string[] {
  const { screenInput, systemAudioInput, output, hasMicAudio } = opts

  // No system audio file: nothing to mux. Stream-copy to a renamed output.
  if (!systemAudioInput) {
    return ['-y', '-i', screenInput, '-c', 'copy', output]
  }

  const filterGraph = hasMicAudio
    ? '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0,aresample=async=1[a]'
    : '[1:a]aresample=async=1[a]'

  return [
    '-y',
    '-i', screenInput,
    '-i', systemAudioInput,
    '-filter_complex', filterGraph,
    '-map', '0:v',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    output,
  ]
}

// macOS variant: the screen capture is a renderer-produced WebM (VP9 +
// optional Opus loopback audio). Optional mic audio is captured by FFmpeg
// to its own AAC/m4a file. Output is MP4 (H.264 + AAC).
//
// Layout (only inputs that exist are added):
//   input 0: screen video (webm) — has video, may have system audio
//   input 1: mic audio (m4a/aac)  — optional
//
// Video is always re-encoded VP9 → H.264. Audio strategy:
//   - webm has system audio + mic present → amix the two, encode AAC
//   - webm has system audio only         → aresample, encode AAC
//   - mic only (no system audio in webm) → copy mic stream from input 1
//   - neither                            → output has no audio track

export interface BuildMacMuxArgsOptions {
  screenWebmInput: string
  micAudioInput: string | undefined
  output: string
  webmHasSystemAudio: boolean
}

export function buildMacMuxArgs(opts: BuildMacMuxArgsOptions): string[] {
  const { screenWebmInput, micAudioInput, output, webmHasSystemAudio } = opts

  const args: string[] = ['-y', '-i', screenWebmInput]
  if (micAudioInput) {
    args.push('-i', micAudioInput)
  }

  // Common video encode settings — match the existing screen-capture profile.
  const videoEncode = [
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
  ]

  if (webmHasSystemAudio && micAudioInput) {
    // Mix the two audio sources. duration=first keeps the output as long as
    // the screen video; aresample corrects clock drift between sources.
    args.push(
      '-filter_complex',
      '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0,aresample=async=1[a]',
      '-map', '0:v',
      '-map', '[a]',
      ...videoEncode,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      output,
    )
    return args
  }

  if (webmHasSystemAudio) {
    args.push(
      '-filter_complex',
      '[0:a]aresample=async=1[a]',
      '-map', '0:v',
      '-map', '[a]',
      ...videoEncode,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      output,
    )
    return args
  }

  if (micAudioInput) {
    // Mic file is already AAC — copy through to avoid double-encoding.
    args.push(
      '-map', '0:v',
      '-map', '1:a',
      ...videoEncode,
      '-c:a', 'copy',
      '-shortest',
      output,
    )
    return args
  }

  // No audio at all — re-encode video, drop audio explicitly.
  args.push('-map', '0:v', ...videoEncode, '-an', output)
  return args
}
