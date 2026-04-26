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
