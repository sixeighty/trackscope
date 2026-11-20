import type {
  ContainerInfo,
  ContainerFormat,
  SpectrumPoint,
  TrackMetrics,
} from '@/types/audio'
import { fft, hannWindow } from './fft'

/* ------------------------------------------------------------------ */
/* Container-Erkennung & Header-Parsing                                */
/* ------------------------------------------------------------------ */

function ascii(view: DataView, offset: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

function detectExtension(name: string): ContainerFormat {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, ContainerFormat> = {
    wav: 'wav', wave: 'wav', mp3: 'mp3', flac: 'flac',
    aif: 'aiff', aiff: 'aiff', aifc: 'aiff', ogg: 'ogg', oga: 'ogg',
    opus: 'opus', m4a: 'm4a', m4b: 'm4a', mp4: 'm4a', aac: 'aac',
  }
  return map[ext] ?? 'unknown'
}

/** 80-Bit IEEE 754 Extended Precision (AIFF Sample-Rate) lesen */
function readFloat80(view: DataView, offset: number): number {
  const expon = view.getUint16(offset)
  const hi = view.getUint32(offset + 2)
  const lo = view.getUint32(offset + 6)
  if (expon === 0 && hi === 0 && lo === 0) return 0
  const mantissa = hi * 2 ** 32 + lo
  return mantissa * 2 ** (expon - 16383 - 63)
}

function parseWav(view: DataView): Partial<ContainerInfo> {
  // fmt-Chunk suchen (Offset 12, Chunks iterieren)
  let off = 12
  let info: Partial<ContainerInfo> = {}
  while (off + 8 <= view.byteLength) {
    const id = ascii(view, off, 4)
    const size = view.getUint32(off + 4, true)
    if (id === 'fmt ') {
      const formatTag = view.getUint16(off + 8, true)
      info.declaredChannels = view.getUint16(off + 10, true)
      info.declaredSampleRate = view.getUint32(off + 12, true)
      const byteRate = view.getUint32(off + 16, true)
      let bits = view.getUint16(off + 22, true)
      // WAVE_FORMAT_EXTENSIBLE: gültige Bits hinter Subformat-GUID
      if (formatTag === 0xfffe && size >= 40) bits = view.getUint16(off + 8 + 18, true)
      info.declaredBitsPerSample = bits
      info.declaredBitrateKbps = Math.round((byteRate * 8) / 1000)
    }
    if (id === 'data' && !info.declaredBitrateKbps && info.declaredChannels && info.declaredBitsPerSample && info.declaredSampleRate) {
      info.declaredBitrateKbps = Math.round(
        ((size * 8) / (info.declaredChannels * info.declaredBitsPerSample * info.declaredSampleRate || 1)) *
          info.declaredSampleRate * info.declaredChannels * info.declaredBitsPerSample / 1000,
      )
    }
    off += 8 + size + (size % 2)
  }
  return info
}

function parseAiff(view: DataView): Partial<ContainerInfo> {
  const info: Partial<ContainerInfo> = {}
  let off = 12
  while (off + 8 <= view.byteLength) {
    const id = ascii(view, off, 4)
    const size = view.getUint32(off + 4) // AIFF = Big Endian
    if (id === 'COMM') {
      info.declaredChannels = view.getInt16(off + 8)
      info.declaredBitsPerSample = view.getInt16(off + 14)
      info.declaredSampleRate = Math.round(readFloat80(view, off + 16))
    }
    off += 8 + size + (size % 2)
  }
  return info
}

const MP3_BITRATES: Record<string, number[]> = {
  // [V1L1, V1L2, V1L3, V2L1, V2L2, V2L3] je Bitrate-Index (kbps)
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
}
const MP3_RATES = [44100, 48000, 32000]

function parseMp3(bytes: Uint8Array): Partial<ContainerInfo> {
  let off = 0
  // ID3v2 überspringen
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size =
      ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f)
    off = 10 + size
  }
  const info: Partial<ContainerInfo> = {}
  // ersten Frame suchen (max. 64 KB scannen)
  const limit = Math.min(bytes.length, off + 65536)
  for (; off + 4 <= limit; off++) {
    if (bytes[off] === 0xff && (bytes[off + 1] & 0xe0) === 0xe0) {
      const b1 = bytes[off + 1], b2 = bytes[off + 2]
      const versionBits = (b1 >> 3) & 0x03
      const layerBits = (b1 >> 1) & 0x03
      const bitrateIdx = (b2 >> 4) & 0x0f
      const rateIdx = (b2 >> 2) & 0x03
      if (versionBits === 1 || layerBits === 0 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) continue
      const v1 = versionBits === 3
      const rate = MP3_RATES[rateIdx] / (v1 ? 1 : versionBits === 2 ? 2 : 4)
      info.declaredSampleRate = rate
      const table = v1 ? MP3_BITRATES.v1 : MP3_BITRATES.v2
      const kbps = table[bitrateIdx]
      if (kbps) info.declaredBitrateKbps = v1 ? kbps : kbps // V2-Werte sind schon skaliert
      // Xing/Info-Header → exakte VBR-Bitrate & Frame-Count
      const version = versionBits === 3 ? 1 : 2
      const layer = 4 - layerBits // layerBits: 01=III → 3
      const channelMode = (bytes[off + 3] >> 6) & 0x03
      const crcBytes = (bytes[off + 1] & 0x01) === 0 ? 2 : 0
      const sideInfo = version === 1 ? (channelMode === 3 ? 17 : 32) : channelMode === 3 ? 9 : 17
      const xingOff = 4 + crcBytes + sideInfo
      if (off + xingOff + 8 <= bytes.length) {
        const tag = String.fromCharCode(bytes[off + xingOff], bytes[off + xingOff + 1], bytes[off + xingOff + 2], bytes[off + xingOff + 3])
        if (tag === 'Xing' || tag === 'Info') {
          const flags = (bytes[off + xingOff + 4] << 24) | (bytes[off + xingOff + 5] << 16) |
            (bytes[off + xingOff + 6] << 8) | bytes[off + xingOff + 7]
          if (flags & 0x01) {
            const frames =
              (bytes[off + xingOff + 8] << 24) | (bytes[off + xingOff + 9] << 16) |
              (bytes[off + xingOff + 10] << 8) | bytes[off + xingOff + 11]
            const bytesPerFrame = layer === 1 ? Math.floor((12 * kbps * 1000) / rate) * 4 : Math.floor(((layer === 3 && version !== 1 ? 72 : 144) * kbps * 1000) / rate)
            const totalBytes = frames * bytesPerFrame
            const durationMs = (frames * (layer === 1 ? 384 : version === 1 ? 1152 : 576) * 1000) / rate
            if (durationMs > 0) info.declaredBitrateKbps = Math.round((totalBytes * 8) / durationMs)
          }
        }
      }
      break
    }
  }
  return info
}

function parseFlac(view: DataView): Partial<ContainerInfo> {
  // "fLaC" dann erster Metadatablock = STREAMINFO (min 34 Byte)
  const info: Partial<ContainerInfo> = {}
  let off = 4
  while (off + 4 <= view.byteLength) {
    const header = view.getUint8(off)
    const blockType = header & 0x7f
    const length = (view.getUint8(off + 1) << 16) | (view.getUint8(off + 2) << 8) | view.getUint8(off + 3)
    if (blockType === 0 && length >= 18) {
      const b = off + 4 + 10 // nach min/max block- & framesize
      const x = view.getUint32(b) // 20 Bit SR | 3 Bit Ch-1 | 5 Bit Bits-1 | (rest in nächstem)
      const y = view.getUint32(b + 4)
      info.declaredSampleRate = (x >>> 12) & 0xfffff
      info.declaredChannels = ((x >>> 9) & 0x07) + 1
      info.declaredBitsPerSample = ((x >>> 4) & 0x1f) + 1
      const totalSamples = ((x & 0x0f) << 32) | (y >>> 0)
      if (info.declaredSampleRate && totalSamples > 0) {
        // bitrate später aus Dateigröße
      }
      break
    }
    off += 4 + length
  }
  return info
}

function parseOgg(bytes: Uint8Array): Partial<ContainerInfo> {
  const info: Partial<ContainerInfo> = {}
  const head = String.fromCharCode(...bytes.slice(0, 8))
  if (!head.startsWith('OggS')) return info
  // erste Seite(n) nach Vorbis-/Opus-Identifikation durchsuchen
  const limit = Math.min(bytes.length, 65536)
  for (let i = 0; i + 30 < limit; i++) {
    if (bytes[i] === 1 && ascii(new DataView(bytes.buffer, bytes.byteOffset + i, 7), 0, 7) === '\x01vorbis') {
      const v = new DataView(bytes.buffer, bytes.byteOffset + i + 7)
      info.declaredSampleRate = v.getUint32(8, true)
      info.declaredChannels = v.getUint8(7)
      break
    }
    if (ascii(new DataView(bytes.buffer, bytes.byteOffset + i, 8), 0, 8) === 'OpusHead') {
      const v = new DataView(bytes.buffer, bytes.byteOffset + i + 8)
      info.declaredChannels = v.getUint8(1)
      info.declaredSampleRate = v.getUint32(4, true)
      break
    }
  }
  return info
}

const LOSSLESS: ContainerFormat[] = ['wav', 'flac', 'aiff']

/**
 * AIFF/AIFC-PCM manuell dekodieren (Chrome kann kein AIFF).
 * Unterstützt 'NONE' (Big Endian) und 'sowt' (Little Endian), 8/16/24/32 bit.
 */
export function decodeAiffPcm(bytes: ArrayBuffer): { channels: Float32Array[]; sampleRate: number; durationSec: number } | null {
  const view = new DataView(bytes)
  if (ascii(view, 0, 4) !== 'FORM') return null
  const formType = ascii(view, 8, 4)
  if (formType !== 'AIFF' && formType !== 'AIFC') return null

  let channels = 0, bits = 0, rate = 0, compression = 'NONE'
  let dataOff = -1, dataLen = 0
  let off = 12
  while (off + 8 <= view.byteLength) {
    const id = ascii(view, off, 4)
    const size = view.getUint32(off + 4) // AIFF = Big Endian
    if (id === 'COMM') {
      channels = view.getInt16(off + 8)
      bits = view.getInt16(off + 14)
      rate = Math.round(readFloat80(view, off + 16))
      if (formType === 'AIFC' && size >= 22) compression = ascii(view, off + 18, 4)
    } else if (id === 'SSND') {
      const soundOff = view.getUint32(off + 8)
      dataOff = off + 16 + soundOff
      dataLen = Math.min(size - 8 - soundOff, view.byteLength - dataOff)
    }
    off += 8 + size + (size % 2)
  }

  if (!channels || !bits || !rate || dataOff < 0 || dataLen <= 0) return null
  if (compression !== 'NONE' && compression !== 'sowt') return null // z.B. ALAW/ULAW → nicht unterstützt
  const littleEndian = compression === 'sowt'
  const bytesPerSample = bits / 8
  const frames = Math.floor(dataLen / (bytesPerSample * channels))
  if (frames <= 0) return null

  const out: Float32Array[] = []
  for (let c = 0; c < channels; c++) out.push(new Float32Array(frames))
  let p = dataOff
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      let v = 0
      if (bits === 8) {
        v = (view.getUint8(p) - 128) / 128
      } else if (bits === 16) {
        v = view.getInt16(p, littleEndian) / 32768
      } else if (bits === 24) {
        if (littleEndian) {
          v = (view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getUint8(p + 2) << 16))
        } else {
          v = (view.getUint8(p) << 16) | (view.getUint8(p + 1) << 8) | view.getUint8(p + 2)
        }
        if (v & 0x800000) v -= 0x1000000
        v /= 8388608
      } else if (bits === 32) {
        v = view.getInt32(p, littleEndian) / 2147483648
      } else {
        return null
      }
      out[c][f] = Math.max(-1, Math.min(1, v))
      p += bytesPerSample
    }
  }
  return { channels: out, sampleRate: rate, durationSec: frames / rate }
}

export function parseContainer(buffer: ArrayBuffer, fileName: string): ContainerInfo {
  const view = new DataView(buffer.slice(0, Math.min(buffer.byteLength, 262144)))
  const bytes = new Uint8Array(view.buffer)
  let format: ContainerFormat = detectExtension(fileName)
  let extra: Partial<ContainerInfo> = {}

  try {
    const magic = ascii(view, 0, 4)
    if (magic === 'RIFF' && ascii(view, 8, 4) === 'WAVE') {
      format = 'wav'
      extra = parseWav(view)
    } else if (magic === 'FORM' && (ascii(view, 8, 4) === 'AIFF' || ascii(view, 8, 4) === 'AIFC')) {
      format = 'aiff'
      extra = parseAiff(view)
    } else if (magic === 'fLaC') {
      format = 'flac'
      extra = parseFlac(view)
    } else if (magic === 'OggS') {
      extra = parseOgg(bytes)
      format = 'ogg'
      // Opus-Identification vorhanden?
      const probe = String.fromCharCode(...bytes.slice(28, 40))
      if (probe.includes('OpusHead')) format = 'opus'
    } else if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      format = 'mp3'
      extra = parseMp3(bytes)
    } else if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
      format = 'mp3'
      extra = parseMp3(bytes)
    } else if (magic === 'ftyp') {
      format = 'm4a'
    }
  } catch {
    // Header-Parsing ist best-effort
  }

  return {
    format,
    declaredSampleRate: extra.declaredSampleRate ?? null,
    declaredChannels: extra.declaredChannels ?? null,
    declaredBitsPerSample: extra.declaredBitsPerSample ?? null,
    declaredBitrateKbps: extra.declaredBitrateKbps ?? null,
    estimatedBitrateKbps: null,
    isLosslessContainer: LOSSLESS.includes(format),
  }
}

/* ------------------------------------------------------------------ */
/* Spektralanalyse                                                     */
/* ------------------------------------------------------------------ */

const FFT_SIZE = 8192
const HOP = 4096

interface StftResult {
  avgPowerDb: Float64Array // N/2 Bins, dB rel. Maximum
  spectrogram: Float64Array[] | null // je Spalte: N/2 Bins in dB
  frameCount: number
}

function runStft(
  data: Float32Array,
  maxAvgFrames = 240,
  specColumns = 360,
): StftResult {
  const nBins = FFT_SIZE / 2
  const window = hannWindow(FFT_SIZE)
  const totalFrames = Math.max(1, Math.floor((data.length - FFT_SIZE) / HOP) + 1)
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)

  // gleichmäßig verteilte Frames für das Mittelungsspektrum
  const avgFrames = Math.min(maxAvgFrames, totalFrames)
  const avgPower = new Float64Array(nBins)
  const binCount = new Uint32Array(nBins)

  // Spektrogramm-Spalten
  const specFrames = Math.min(specColumns, totalFrames)
  let spectrogram: Float64Array[] | null = null
  if (specFrames >= 4) {
    spectrogram = []
    for (let c = 0; c < specFrames; c++) {
      const start = Math.floor((c / Math.max(1, specFrames - 1)) * (totalFrames - 1)) * HOP
      fillFrame(data, start, window, re, im)
      fft(re, im)
      const col = new Float64Array(nBins)
      for (let b = 1; b < nBins; b++) col[b] = re[b] * re[b] + im[b] * im[b]
      spectrogram.push(col)
    }
  }

  for (let f = 0; f < avgFrames; f++) {
    const start = Math.floor((f / Math.max(1, avgFrames - 1)) * Math.max(0, totalFrames - 1)) * HOP
    fillFrame(data, start, window, re, im)
    fft(re, im)
    for (let b = 1; b < nBins; b++) {
      const p = re[b] * re[b] + im[b] * im[b]
      if (p > 0) {
        avgPower[b] += p
        binCount[b]++
      }
    }
  }

  let maxDb = -Infinity
  const avgPowerDb = new Float64Array(nBins)
  for (let b = 1; b < nBins; b++) {
    const p = binCount[b] > 0 ? avgPower[b] / binCount[b] : 0
    const db = p > 0 ? 10 * Math.log10(p) : -120
    avgPowerDb[b] = db
    if (db > maxDb) maxDb = db
  }
  for (let b = 1; b < nBins; b++) avgPowerDb[b] -= maxDb

  return { avgPowerDb, spectrogram, frameCount: totalFrames }
}

function fillFrame(
  data: Float32Array,
  start: number,
  window: Float64Array,
  re: Float64Array,
  im: Float64Array,
): void {
  im.fill(0)
  const len = Math.min(FFT_SIZE, data.length - start)
  for (let i = 0; i < FFT_SIZE; i++) {
    re[i] = i < len ? data[start + i] * window[i] : 0
  }
}

/** geglätteter Verlauf ±smooth Bins */
function smoothDb(db: Float64Array, binHz: number, smoothHz: number): Float64Array {
  const k = Math.max(1, Math.round(smoothHz / binHz))
  const out = new Float64Array(db.length)
  for (let b = 1; b < db.length; b++) {
    let sum = 0, cnt = 0
    for (let j = Math.max(1, b - k); j <= Math.min(db.length - 1, b + k); j++) {
      sum += db[j]; cnt++
    }
    out[b] = cnt ? sum / cnt : db[b]
  }
  return out
}

/**
 * Cutoff bestimmen:
 *  1) harte Shelf-Kante suchen (typisch für MP3/Lossy-Cutoff)
 *  2) sonst: weiche Energiegrenze (peak −50 dB)
 */
export function detectCutoff(
  avgPowerDb: Float64Array,
  sampleRate: number,
): { cutoffHz: number; hardShelf: boolean } {
  const nBins = avgPowerDb.length
  const binHz = sampleRate / FFT_SIZE
  const smooth = smoothDb(avgPowerDb, binHz, 120)
  const minBin = Math.round(2000 / binHz)

  // 1) harte Kante: Abfall > 28 dB auf 250 Hz, danach mindestens 1.5 kHz darunter bleiben
  for (let b = nBins - 2; b > minBin; b--) {
    const f = b * binHz
    if (f > sampleRate * 0.48) continue
    const idx250 = Math.max(minBin, b - Math.round(250 / binHz))
    if (smooth[b] - smooth[idx250] > -28) continue
    // muss mindestens 1.5 kHz darunter bleiben
    let stays = true
    for (let j = b + 1; j < Math.min(nBins - 1, b + Math.round(1500 / binHz)); j++) {
      if (smooth[j] > smooth[idx250] - 18) { stays = false; break }
    }
    if (stays) return { cutoffHz: Math.round(f), hardShelf: true }
  }

  // 2) weiche Grenze: oberster Bin über peak −50 dB
  let peak = -Infinity
  for (let b = minBin; b < nBins; b++) if (smooth[b] > peak) peak = smooth[b]
  for (let b = nBins - 1; b > minBin; b--) {
    if (smooth[b] >= peak - 50) return { cutoffHz: Math.round(b * binHz), hardShelf: false }
  }
  return { cutoffHz: 0, hardShelf: false }
}

/** Cutoff → geschätzte Quell-Qualität */
export function estimateSource(cutoffHz: number): string | null {
  if (!cutoffHz || cutoffHz < 8000) return null
  if (cutoffHz < 15500) return '≤128 kbps MP3'
  if (cutoffHz < 17500) return '~160 kbps MP3'
  if (cutoffHz < 19000) return '~192–224 kbps MP3'
  if (cutoffHz < 20200) return '~256 kbps MP3'
  if (cutoffHz < 21500) return '~320 kbps MP3'
  return 'Lossless / CD-Qualität'
}

/* ------------------------------------------------------------------ */
/* Pegel-, Dynamik- & Stereo-Metriken                                  */
/* ------------------------------------------------------------------ */

function analyzeLevels(
  channels: Float32Array[],
  sampleRate: number,
): Pick<
  TrackMetrics,
  'peakDb' | 'rmsDb' | 'lufsApprox' | 'dynamicRangeDb' | 'clippingPercent' | 'stereoCorrelation' | 'sideMidRatioDb'
> {
  const block = Math.floor(sampleRate * 0.4)
  const nCh = channels.length
  let peak = 0, sumSq = 0, total = 0, clipCount = 0
  const blockRms: number[] = []
  const blockPeak: number[] = []

  const nBlocks = Math.max(1, Math.floor(channels[0].length / block))
  for (let bi = 0; bi < nBlocks; bi++) {
    const start = bi * block
    let bSum = 0, bPeak = 0, bClip = 0
    const end = Math.min(start + block, channels[0].length)
    for (let i = start; i < end; i++) {
      let m = 0
      for (let c = 0; c < nCh; c++) {
        const v = channels[c][i]
        const a = Math.abs(v)
        if (a > m) m = a
        sumSq += v * v
        if (a >= 0.999) clipCount++
      }
      if (m > bPeak) bPeak = m
      bSum += m * m
      total++
      if (m >= 0.999) bClip++
    }
    blockRms.push(10 * Math.log10(bSum / (end - start) + 1e-12))
    blockPeak.push(20 * Math.log10(bPeak + 1e-12))
    void bClip
  }

  peak = Math.max(...blockPeak)
  const rmsDb = 10 * Math.log10(sumSq / (total * nCh) + 1e-12)

  // vereinfachte LUFS: absolute + relative Gating, ohne K-Gewichtung
  const powers = blockRms.map((db) => Math.pow(10, db / 10)).filter((p) => p > Math.pow(10, -7))
  let lufs = -70
  if (powers.length > 0) {
    const mean1 = powers.reduce((a, b) => a + b, 0) / powers.length
    const thr = mean1 * Math.pow(10, -1)
    const rel = powers.filter((p) => p >= thr)
    if (rel.length > 0) {
      const mean2 = rel.reduce((a, b) => a + b, 0) / rel.length
      lufs = -0.691 + 10 * Math.log10(mean2)
    }
  }

  const sorted = [...blockRms].sort((a, b) => a - b)
  const p20 = sorted[Math.floor(sorted.length * 0.2)] ?? rmsDb
  const dynamicRangeDb = Math.max(0, peak - p20)

  const clippingPercent = total > 0 ? (clipCount / (total * nCh)) * 100 : 0

  // Stereo: Korrelation & Side/Mid auf Downsample (jeder 13. Sample)
  let stereoCorrelation: number | null = null
  let sideMidRatioDb: number | null = null
  if (nCh >= 2) {
    const L = channels[0], R = channels[1]
    const step = 13
    let sLR = 0, sLL = 0, sRR = 0, sSide = 0, sMid = 0, cnt = 0
    for (let i = 0; i < L.length; i += step) {
      const l = L[i], r = R[i]
      sLR += l * r; sLL += l * l; sRR += r * r
      const mid = (l + r) / 2, side = (l - r) / 2
      sMid += mid * mid; sSide += side * side
      cnt++
    }
    stereoCorrelation = sLL > 0 && sRR > 0 ? sLR / Math.sqrt(sLL * sRR) : null
    sideMidRatioDb = sMid > 0 ? 10 * Math.log10(sSide / sMid + 1e-12) : null
  }

  return {
    peakDb: peak, rmsDb, lufsApprox: lufs, dynamicRangeDb,
    clippingPercent, stereoCorrelation, sideMidRatioDb,
  }
}

/* ------------------------------------------------------------------ */
/* Spektrogramm rendern                                                */
/* ------------------------------------------------------------------ */

function renderSpectrogram(
  cols: Float64Array[] | null,
  sampleRate: number,
  width = 720,
  height = 260,
): string | null {
  if (!cols || cols.length < 4) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // globaler Max pro Spalte → dB
  const dbCols = cols.map((col) => {
    let m = 0
    for (let b = 1; b < col.length; b++) if (col[b] > m) m = col[b]
    const out = new Float64Array(col.length)
    for (let b = 1; b < col.length; b++) out[b] = m > 0 ? 10 * Math.log10(col[b] / m + 1e-10) : -100
    return out
  })

  const minF = 30, maxF = sampleRate / 2
  const minDb = -90, maxDb = -10
  const rowToBin = new Float64Array(height)
  for (let y = 0; y < height; y++) {
    const t = 1 - y / (height - 1) // 0 = unten
    const f = minF * Math.pow(maxF / minF, t)
    rowToBin[y] = f / (sampleRate / cols[0].length / 2) // Bin-Breite
  }

  const img = ctx.createImageData(width, height)
  const colW = width / cols.length
  for (let cx = 0; cx < cols.length; cx++) {
    const db = dbCols[cx]
    const x0 = Math.floor(cx * colW), x1 = Math.max(x0 + 1, Math.floor((cx + 1) * colW))
    for (let y = 0; y < height; y++) {
      const bin = Math.min(db.length - 1, Math.max(1, Math.round(rowToBin[y])))
      const v = Math.min(1, Math.max(0, (db[bin] - minDb) / (maxDb - minDb)))
      const [r, g, b] = heatColor(v)
      for (let x = x0; x < x1 && x < width; x++) {
        const idx = (y * width + x) * 4
        img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = b; img.data[idx + 3] = 255
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

/** dunkle Hitzeskala: Schwarz → Grün → Lime → Weiß */
function heatColor(v: number): [number, number, number] {
  if (v < 0.5) {
    const t = v / 0.5
    return [Math.round(8 + 90 * t), Math.round(20 + 160 * t), Math.round(14 + 60 * t)]
  }
  const t = (v - 0.5) / 0.5
  return [Math.round(98 + 150 * t), Math.round(180 + 70 * t), Math.round(74 + 170 * t)]
}

/* ------------------------------------------------------------------ */
/* Öffentliche API                                                     */
/* ------------------------------------------------------------------ */

export function logSpectrum(
  avgPowerDb: Float64Array,
  sampleRate: number,
  points = 220,
): SpectrumPoint[] {
  const nBins = avgPowerDb.length
  const binHz = sampleRate / FFT_SIZE
  const minF = 20, maxF = sampleRate / 2
  const out: SpectrumPoint[] = []
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1)
    const f = minF * Math.pow(maxF / minF, t)
    const b = Math.min(nBins - 1, Math.max(1, Math.round(f / binHz)))
    out.push({ hz: Math.round(f), db: Math.round(avgPowerDb[b] * 10) / 10 })
  }
  return out
}

export interface RawAnalysis {
  metrics: TrackMetrics
  spectrum: SpectrumPoint[]
  spectrogram: string | null
  avgPowerDb: Float64Array
}

export interface DecodedAudio {
  sampleRate: number
  duration: number
  length: number
  numberOfChannels: number
  getChannelData(channel: number): Float32Array
}

export async function analyzeAudio(
  file: File,
  audioBuffer: DecodedAudio,
  container: ContainerInfo,
): Promise<RawAnalysis> {
  const channels: Float32Array[] = []
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    channels.push(audioBuffer.getChannelData(c))
  }
  // Mono-Mix für STFT
  const mono = new Float32Array(audioBuffer.length)
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c]
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / channels.length
  }

  const stft = runStft(mono)
  const levels = analyzeLevels(channels, audioBuffer.sampleRate)
  const { cutoffHz, hardShelf } = detectCutoff(stft.avgPowerDb, audioBuffer.sampleRate)

  const durationSec = audioBuffer.duration
  const estimatedBitrateKbps =
    durationSec > 0 ? Math.round((file.size * 8) / durationSec / 1000) : null

  const metrics: TrackMetrics = {
    durationSec,
    sampleRate: audioBuffer.sampleRate,
    channels: audioBuffer.numberOfChannels,
    fileSizeBytes: file.size,
    ...levels,
    cutoffHz: cutoffHz > 0 ? cutoffHz : null,
    hardShelf,
    sourceEstimate: estimateSource(cutoffHz),
    cutoffConfidence: hardShelf ? 'high' : cutoffHz > 0 ? 'medium' : 'low',
  }

  container.estimatedBitrateKbps = estimatedBitrateKbps

  return {
    metrics,
    spectrum: logSpectrum(stft.avgPowerDb, audioBuffer.sampleRate),
    spectrogram: renderSpectrogram(stft.spectrogram, audioBuffer.sampleRate),
    avgPowerDb: stft.avgPowerDb,
  }
}
