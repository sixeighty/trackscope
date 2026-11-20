export type ContainerFormat =
  | 'wav'
  | 'mp3'
  | 'flac'
  | 'aiff'
  | 'ogg'
  | 'opus'
  | 'm4a'
  | 'aac'
  | 'unknown'

export type VerdictKind =
  | 'genuine-lossless'
  | 'likely-lossless'
  | 'fake-lossless'
  | 'lossy-good'
  | 'lossy-mid'
  | 'lossy-bad'
  | 'transcode-mismatch'
  | 'unknown'

export interface ContainerInfo {
  format: ContainerFormat
  declaredSampleRate: number | null
  declaredChannels: number | null
  declaredBitsPerSample: number | null
  declaredBitrateKbps: number | null // from header (Xing/Vorbis/STREAMINFO…)
  estimatedBitrateKbps: number | null // fileSize * 8 / duration
  isLosslessContainer: boolean
}

export interface TrackMetrics {
  durationSec: number
  sampleRate: number
  channels: number
  fileSizeBytes: number
  peakDb: number
  rmsDb: number
  lufsApprox: number
  dynamicRangeDb: number
  clippingPercent: number
  stereoCorrelation: number | null // null for mono
  sideMidRatioDb: number | null
  cutoffHz: number | null
  hardShelf: boolean
  sourceEstimate: string | null // z.B. "~320 kbps MP3"
  cutoffConfidence: 'high' | 'medium' | 'low'
}

export interface SpectrumPoint {
  hz: number
  db: number
}

export interface TrackAnalysis {
  id: string
  fileName: string
  analyzedAt: number
  container: ContainerInfo
  metrics: TrackMetrics
  grade: string // A+ … F
  score: number // 0–100
  verdict: VerdictKind
  verdictLabel: string
  verdictDetail: string
  issues: string[]
  /** gemitteltes Leistungsspektrum, logarithmisch gebinnt */
  spectrum: SpectrumPoint[]
  /** Spektrogramm als PNG data-URL (max ~ 720×300) */
  spectrogram: string | null
  error: string | null
}
