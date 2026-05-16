// --- Types ---
export type BackgroundType = 'color' | 'gradient' | 'image' | 'wallpaper'
export type AspectRatio = '16:9' | '9:16' | '4:3' | '3:4' | '1:1'
export type SidePanelTab = 'general' | 'camera' | 'cursor' | 'audio' | 'animation' | 'settings'

export interface Background {
  type: BackgroundType
  color?: string
  gradientStart?: string
  gradientEnd?: string
  gradientDirection?: string
  imageUrl?: string
  thumbnailUrl?: string
}

export interface FrameStyles {
  padding: number
  background: Background
  borderRadius: number
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  shadowColor: string
  borderWidth: number
  borderColor: string
}

export interface CursorStyles {
  showCursor: boolean
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  shadowColor: string
  // Click Effects
  clickRippleEffect: boolean
  clickRippleColor: string
  clickRippleSize: number
  clickRippleDuration: number
  clickScaleEffect: boolean
  clickScaleAmount: number
  clickScaleDuration: number
  clickScaleEasing: string
}

export interface Preset {
  id: string
  name: string
  styles: FrameStyles
  aspectRatio: AspectRatio
  isDefault?: boolean
  webcamStyles?: WebcamStyles
  webcamPosition?: WebcamPosition
  isWebcamVisible?: boolean
}

export interface ZoomRegion {
  id: string
  type: 'zoom'
  startTime: number
  duration: number
  zoomLevel: number
  easing: string // Changed from 'linear' | 'ease-in-out'
  transitionDuration: number // New property for speed
  targetX: number
  targetY: number
  mode: 'auto' | 'fixed'
  zIndex: number
}

export interface CutRegion {
  id: string
  type: 'cut'
  startTime: number
  duration: number
  trimType?: 'start' | 'end'
  zIndex: number
}

export interface SpeedRegion {
  id: string
  type: 'speed'
  startTime: number
  duration: number
  speed: number // e.g., 1.5 for 1.5x speed
  zIndex: number
}

export type TimelineRegion = ZoomRegion | CutRegion | SpeedRegion

export interface MetaDataItem {
  timestamp: number
  x: number
  y: number
  type: 'click' | 'move' | 'scroll'
  button?: string
  pressed?: boolean
  cursorImageKey?: string
}

export interface CursorFrame {
  width: number
  height: number
  xhot: number
  yhot: number
  delay: number
  rgba: Buffer
}

export interface CursorImageBase {
  width: number
  height: number
  xhot: number
  yhot: number
}

export interface CursorImage extends CursorImageBase {
  image: number[]
}

export interface CursorImageBitmap extends CursorImageBase {
  imageBitmap: ImageBitmap
}

export interface WebcamPosition {
  pos:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'
    | 'left-center'
    | 'right-center'
}

export type WebcamShape = 'circle' | 'square' | 'rectangle'

export interface WebcamStyles {
  shape: WebcamShape
  borderRadius: number
  size: number
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  shadowColor: string
  isFlipped: boolean
  scaleOnZoom: boolean
  smartPosition: boolean
}

export type Dimensions = { width: number; height: number }
export type RecordingGeometry = { x: number; y: number; width: number; height: number }
export type VideoDimensions = Dimensions
export type ScreenSize = Dimensions
export type CursorTheme = Record<number, Record<string, CursorFrame[]>>

// --- Slice State & Actions Types ---

export interface ProjectState {
  videoPath: string | null
  metadataPath: string | null
  videoUrl: string | null
  videoDimensions: VideoDimensions
  recordingGeometry: RecordingGeometry | null
  screenSize: ScreenSize | null
  canvasDimensions: Dimensions
  metadata: MetaDataItem[]
  duration: number
  cursorImages: Record<string, CursorImage>
  cursorBitmapsToRender: Map<string, CursorImageBitmap>
  syncOffset: number
  platform: NodeJS.Platform | null
  cursorTheme: CursorTheme | null
  hasAudioTrack: boolean
}

export interface ProjectActions {
  loadProject: (paths: { videoPath: string; metadataPath: string; webcamVideoPath?: string }) => Promise<void>
  setVideoDimensions: (dims: { width: number; height: number }) => void
  setDuration: (duration: number) => void
  resetProjectState: () => void
  setPostProcessingCursorScale: (scale: number) => Promise<void>
  reloadCursorTheme: (themeName: string) => Promise<void>
  setHasAudioTrack: (hasAudio: boolean) => void
}

export interface PlaybackState {
  isPlaying: boolean
  currentTime: number
}
export interface PlaybackActions {
  setCurrentTime: (time: number) => void
  togglePlay: () => void
  setPlaying: (isPlaying: boolean) => void
  seekToPreviousFrame: () => void
  seekToNextFrame: () => void
  seekBackward: (seconds: number) => void
  seekForward: (seconds: number) => void
}

export interface FrameState {
  frameStyles: FrameStyles
  aspectRatio: AspectRatio
}
export interface FrameActions {
  updateFrameStyle: (style: Partial<Omit<FrameStyles, 'background'>>) => void
  updateBackground: (bg: Partial<Background>) => void
  setAspectRatio: (ratio: AspectRatio) => void
}

export interface TimelineState {
  zoomRegions: Record<string, ZoomRegion>
  cutRegions: Record<string, CutRegion>
  speedRegions: Record<string, SpeedRegion>
  previewCutRegion: CutRegion | null
  selectedRegionId: string | null
  activeZoomRegionId: string | null
  isCurrentlyCut: boolean
  timelineZoom: number
}
export interface TimelineActions {
  addZoomRegion: () => void
  addCutRegion: (regionData?: Partial<CutRegion>) => void
  addSpeedRegion: () => void
  updateRegion: (id: string, updates: Partial<TimelineRegion>) => void
  deleteRegion: (id: string) => void
  setSelectedRegionId: (id: string | null) => void
  setPreviewCutRegion: (region: CutRegion | null) => void
  setTimelineZoom: (zoom: number) => void
  applyAnimationSettingsToAll: (settings: { transitionDuration: number; easing: string; zoomLevel: number }) => void
  applySpeedToAll: (speed: number) => void
}

export interface PresetState {
  presets: Record<string, Preset>
  activePresetId: string | null
  presetSaveStatus: 'idle' | 'saving' | 'saved'
}
export interface PresetActions {
  initializePresets: () => Promise<void>
  applyPreset: (id: string) => void
  resetPreset: (id: string) => void
  updatePresetName: (id: string, name: string) => void
  saveCurrentStyleAsPreset: (name: string) => void
  updateActivePreset: () => void
  deletePreset: (id: string) => void
  _ensureActivePresetIsWritable: () => void
  _persistPresets: (presets: Record<string, Preset>) => Promise<void>
}

export interface WebcamState {
  webcamVideoPath: string | null
  webcamVideoUrl: string | null
  isWebcamVisible: boolean
  webcamPosition: WebcamPosition
  webcamStyles: WebcamStyles
}
export interface WebcamActions {
  setWebcamPosition: (position: WebcamPosition) => void
  setWebcamVisibility: (isVisible: boolean) => void
  updateWebcamStyle: (style: Partial<WebcamStyles>) => void
}

export interface UIState {
  mode: 'light' | 'dark'
  isPreviewFullScreen: boolean
  cursorThemeName: string
  cursorStyles: CursorStyles
  activeSidePanelTab: SidePanelTab
}
export interface UIActions {
  toggleMode: () => void
  initializeSettings: () => Promise<void>
  togglePreviewFullScreen: () => void
  setCursorThemeName: (themeName: string) => void
  updateCursorStyle: (style: Partial<CursorStyles>) => void
  setActiveSidePanelTab: (tab: SidePanelTab) => void
}

export interface AudioState {
  volume: number // 0 to 1
  isMuted: boolean
}

export interface AudioActions {
  setVolume: (volume: number) => void
  toggleMute: () => void
  setIsMuted: (isMuted: boolean) => void
}

export type RenderableState = Pick<
  EditorState,
  | 'platform'
  | 'frameStyles'
  | 'videoDimensions'
  | 'aspectRatio'
  | 'webcamPosition'
  | 'webcamStyles'
  | 'isWebcamVisible'
  | 'zoomRegions'
  | 'cutRegions'
  | 'speedRegions'
  | 'metadata'
  | 'recordingGeometry'
  | 'cursorImages'
  | 'cursorBitmapsToRender'
  | 'syncOffset'
  | 'cursorTheme'
  | 'cursorStyles'
>

// Combined state type for the editor store
export type EditorState = ProjectState &
  PlaybackState &
  FrameState &
  TimelineState &
  PresetState &
  WebcamState &
  UIState &
  AudioState

// Combined actions type for the editor store
export type EditorActions = ProjectActions &
  PlaybackActions &
  FrameActions &
  TimelineActions &
  PresetActions &
  WebcamActions &
  UIActions &
  AudioActions & {
    // Global reset action
    reset: () => void
  }

// A utility type to create actions for a slice
export type Slice<T extends object, A extends object> = (
  set: (fn: (draft: EditorState) => void) => void,
  get: () => EditorState & EditorActions,
) => T & A
