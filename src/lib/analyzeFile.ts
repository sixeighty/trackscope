import type { TrackAnalysis } from '@/types/audio'
import { analyzeAudio, decodeAiffPcm, parseContainer, type DecodedAudio } from './analyzer'
import { gradeTrack } from './grade'

let counter = 0

export async function analyzeFile(file: File): Promise<TrackAnalysis> {
  const id = `${Date.now()}-${counter++}`
  const base = {
    id,
    fileName: file.name,
    analyzedAt: Date.now(),
  }

  try {
    const headBytes = await file.slice(0, 262144).arrayBuffer()
    const container = parseContainer(headBytes, file.name)

    const AC: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AC()
    let buffer: DecodedAudio
    try {
      const allBytes = await file.arrayBuffer()
      try {
        // pass a copy: decodeAudioData detaches the buffer it receives
        buffer = await ctx.decodeAudioData(allBytes.slice(0))
      } catch {
        // Fallback: decode AIFF/AIFC PCM manually (Chromium can't decode AIFF)
        if (container.format === 'aiff') {
          const d = decodeAiffPcm(allBytes)
          if (!d) throw new Error('AIFF file could not be decoded (uncompressed PCM expected)')
          buffer = {
            sampleRate: d.sampleRate,
            duration: d.durationSec,
            length: d.channels[0]?.length ?? 0,
            numberOfChannels: d.channels.length,
            getChannelData: (c: number) => d.channels[c],
          }
        } else {
          throw new Error('Audio format not decodable by this browser')
        }
      }
    } finally {
      void ctx.close()
    }

    const raw = await analyzeAudio(file, buffer, container)
    const g = gradeTrack(container, raw.metrics)

    return {
      ...base,
      container,
      metrics: raw.metrics,
      spectrum: raw.spectrum,
      spectrogram: raw.spectrogram,
      grade: g.grade,
      score: g.score,
      verdict: g.verdict,
      verdictLabel: g.verdictLabel,
      verdictDetail: g.verdictDetail,
      issues: g.issues,
      error: null,
    }
  } catch (err) {
    return {
      ...base,
      container: {
        format: 'unknown',
        declaredSampleRate: null,
        declaredChannels: null,
        declaredBitsPerSample: null,
        declaredBitrateKbps: null,
        estimatedBitrateKbps: null,
        isLosslessContainer: false,
      },
      metrics: {
        durationSec: 0, sampleRate: 0, channels: 0, fileSizeBytes: file.size,
        peakDb: 0, rmsDb: 0, lufsApprox: -70, dynamicRangeDb: 0,
        clippingPercent: 0, stereoCorrelation: null, sideMidRatioDb: null,
        cutoffHz: null, hardShelf: false, sourceEstimate: null, cutoffConfidence: 'low',
      },
      grade: '?',
      score: 0,
      verdict: 'unknown',
      verdictLabel: 'Error',
      verdictDetail: '',
      issues: [],
      spectrum: [],
      spectrogram: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
