import type { ContainerInfo, TrackAnalysis, TrackMetrics, VerdictKind } from '@/types/audio'

export interface GradeResult {
  grade: string
  score: number
  verdict: VerdictKind
  verdictLabel: string
  verdictDetail: string
  issues: string[]
}

/** Quell-Bitrate aus Cutoff schätzen (kbps) – null = vermutlich lossless */
function cutoffToKbps(cutoffHz: number | null): number | null {
  if (!cutoffHz) return null
  if (cutoffHz < 15500) return 128
  if (cutoffHz < 17500) return 160
  if (cutoffHz < 19000) return 192
  if (cutoffHz < 20200) return 224
  if (cutoffHz < 21500) return 320
  return null
}

export function gradeTrack(
  container: ContainerInfo,
  m: TrackMetrics,
): GradeResult {
  const issues: string[] = []
  const kbpsFromCutoff = cutoffToKbps(m.cutoffHz)
  const isLossless = container.isLosslessContainer
  const declaredBr = container.declaredBitrateKbps
  const cutoff = m.cutoffHz ?? 0

  let verdict: VerdictKind = 'unknown'
  let verdictLabel = 'Inconclusive'
  let verdictDetail = 'Not enough information for a verdict.'
  let score = 50
  let grade = 'C'

  if (isLossless) {
    if (cutoff >= 21000) {
      verdict = 'genuine-lossless'
      verdictLabel = 'Genuine Lossless'
      verdictDetail = `Spectrum extends to ${(cutoff / 1000).toFixed(1)} kHz – no lossy cutoff detected.`
      score = 95
      grade = 'A'
    } else if (m.hardShelf && cutoff >= 19500 && kbpsFromCutoff === 320) {
      // harte Kante knapp unter 21 kHz: klassischer 320k-MP3-Fake
      verdict = 'fake-lossless'
      verdictLabel = 'Suspected Fake: 320k Source'
      verdictDetail = `Hard spectral edge at ${(cutoff / 1000).toFixed(1)} kHz – typical of files converted from a 320k MP3. Genuine lossless masters usually reach ~22 kHz. Exception: vinyl rip.`
      score = 60
      grade = 'B-'
      issues.push(`Hard cutoff edge at ${(cutoff / 1000).toFixed(1)} kHz – likely created from a 320k MP3`)
    } else if (cutoff >= 19500) {
      verdict = 'likely-lossless'
      verdictLabel = 'Likely Lossless'
      verdictDetail = `Spectrum extends to ${(cutoff / 1000).toFixed(1)} kHz – just below the typical 320k MP3 cutoff.`
      score = 82
      grade = 'B+'
    } else if (kbpsFromCutoff) {
      verdict = 'fake-lossless'
      verdictLabel = 'Fake Lossless'
      verdictDetail = `File is disguised as ${container.format.toUpperCase()}, but the spectrum ends at ${(cutoff / 1000).toFixed(1)} kHz – typical of ${m.sourceEstimate}.`
      if (kbpsFromCutoff >= 320) { score = 52; grade = 'C' }
      else if (kbpsFromCutoff >= 192) { score = 38; grade = 'D' }
      else { score = 20; grade = 'F' }
      issues.push(`Disguised as ${container.format.toUpperCase()}, but content comes from a lossy source (~${kbpsFromCutoff} kbps)`)
    }
    // Upsampling-Check: deklariert Hi-Res, aber Inhalt nicht
    if ((container.declaredSampleRate ?? m.sampleRate) > 48000 && cutoff > 0 && cutoff < 21000) {
      issues.push(
        `Upsampled: declared ${(container.declaredSampleRate ?? m.sampleRate) / 1000} kHz, but spectrum ends at ${(cutoff / 1000).toFixed(1)} kHz`,
      )
      if (verdict === 'genuine-lossless' || verdict === 'likely-lossless') {
        verdict = 'fake-lossless'
        verdictLabel = 'Upsampled Hi-Res'
        verdictDetail = `Declared ${(container.declaredSampleRate ?? m.sampleRate) / 1000} kHz, but the content has no energy above ${(cutoff / 1000).toFixed(1)} kHz – pure wasted storage space.`
        score = Math.min(score, 55)
        grade = 'C'
      }
    }
  } else {
    // Lossy-Container
    if (kbpsFromCutoff === null) {
      if (cutoff >= 21000) {
        // hochwertiger Lossy-Codec (AAC/Opus o.ä.) mit vollem Band
        verdict = 'lossy-good'
        verdictLabel = 'Good Lossy Quality'
        verdictDetail = `Full spectrum up to ${(cutoff / 1000).toFixed(1)} kHz – modern codec with high efficiency.`
        score = 80
        grade = 'B+'
      }
    } else {
      if (kbpsFromCutoff >= 320) { verdict = 'lossy-good'; verdictLabel = 'Top Lossy'; score = 82; grade = 'B+' }
      else if (kbpsFromCutoff >= 224) { verdict = 'lossy-good'; verdictLabel = 'Good Lossy Quality'; score = 72; grade = 'B' }
      else if (kbpsFromCutoff >= 192) { verdict = 'lossy-mid'; verdictLabel = 'Average Lossy Quality'; score = 58; grade = 'C+' }
      else if (kbpsFromCutoff >= 160) { verdict = 'lossy-mid'; verdictLabel = 'Weak Lossy Quality'; score = 42; grade = 'D' }
      else { verdict = 'lossy-bad'; verdictLabel = 'Low Lossy Quality'; score = 22; grade = 'F' }
      verdictDetail = `Spectrum ends at ${(cutoff / 1000).toFixed(1)} kHz – source is roughly ${m.sourceEstimate}.`
    }
    // deklarierte vs. spektrale Bitrate → Transcode-Erkennung
    if (declaredBr && kbpsFromCutoff && declaredBr >= 256 && kbpsFromCutoff < declaredBr * 0.75) {
      verdict = 'transcode-mismatch'
      verdictLabel = 'Transcode (Upscaled)'
      verdictDetail = `Labeled as ${declaredBr} kbps, but the spectrum only matches ~${kbpsFromCutoff} kbps – probably upscaled from a weaker source.`
      score = Math.min(score, 35)
      grade = 'D'
      issues.push(`Bitrate label says ${declaredBr} kbps, actual spectrum only ~${kbpsFromCutoff} kbps`)
    }
  }

  // technische Mängel
  if (m.clippingPercent > 0.01) {
    issues.push(`Clipping: ${m.clippingPercent.toFixed(2)}% of samples at the limit`)
    if (m.clippingPercent > 0.5) score -= 8
    if (m.clippingPercent > 5) score -= 10
  }
  if (m.dynamicRangeDb > 0 && m.dynamicRangeDb < 4) {
    issues.push(`Very low dynamics (${m.dynamicRangeDb.toFixed(1)} dB) – heavily compressed/mastered`)
    score -= 5
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  return { grade, score, verdict, verdictLabel, verdictDetail, issues }
}

export function verdictTone(verdict: VerdictKind): 'good' | 'mid' | 'bad' | 'neutral' {
  switch (verdict) {
    case 'genuine-lossless':
    case 'likely-lossless':
    case 'lossy-good':
      return 'good'
    case 'lossy-mid':
    case 'unknown':
      return 'mid'
    case 'fake-lossless':
    case 'lossy-bad':
    case 'transcode-mismatch':
      return 'bad'
    default:
      return 'neutral'
  }
}

export function gradeTone(grade: string): 'good' | 'mid' | 'bad' {
  const first = grade.charAt(0)
  if (first === 'A') return 'good'
  if (first === 'B') return 'good'
  if (first === 'C') return 'mid'
  return 'bad'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function toCsv(analyses: TrackAnalysis[]): string {
  const header = [
    'File', 'Format', 'Grade', 'Score', 'Verdict', 'Duration_s', 'SampleRate',
    'Channels', 'FileSize_bytes', 'Bitrate_declared_kbps', 'Bitrate_estimated_kbps',
    'Cutoff_Hz', 'EstimatedSource', 'Peak_dB', 'RMS_dB', 'LUFS_approx',
    'DynamicRange_dB', 'Clipping_pct', 'StereoCorrelation',
  ]
  const rows = analyses.map((a) => [
    a.fileName, a.container.format, a.grade, a.score, a.verdictLabel,
    a.metrics.durationSec.toFixed(2), a.metrics.sampleRate, a.metrics.channels,
    a.metrics.fileSizeBytes, a.container.declaredBitrateKbps ?? '',
    a.container.estimatedBitrateKbps ?? '', a.metrics.cutoffHz ?? '',
    a.metrics.sourceEstimate ?? '', a.metrics.peakDb.toFixed(1),
    a.metrics.rmsDb.toFixed(1), a.metrics.lufsApprox.toFixed(1),
    a.metrics.dynamicRangeDb.toFixed(1), a.metrics.clippingPercent.toFixed(3),
    a.metrics.stereoCorrelation?.toFixed(3) ?? '',
  ])
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header, ...rows].map((r) => r.map(esc).join(';')).join('\n')
}
