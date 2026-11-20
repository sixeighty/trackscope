import { useEffect, useRef } from 'react'
import type { SpectrumPoint } from '@/types/audio'

interface Props {
  spectrum: SpectrumPoint[]
  cutoffHz: number | null
  height?: number
}

/** Log-Frequenz-Leistungsspektrum als Canvas-Chart, mit Cutoff-Marker */
export default function SpectrumChart({ spectrum, cutoffHz, height = 220 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || spectrum.length < 2) return
    const parent = canvas.parentElement
    if (!parent) return

    const dpr = window.devicePixelRatio || 1
    const width = parent.clientWidth
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const padL = 34, padR = 8, padT = 14, padB = 22
    const iw = width - padL - padR
    const ih = height - padT - padB
    const minDb = -110, maxDb = 0
    const minF = spectrum[0].hz
    const maxF = spectrum[spectrum.length - 1].hz

    const x = (f: number) => padL + (Math.log(f / minF) / Math.log(maxF / minF)) * iw
    const y = (db: number) => padT + (1 - (db - minDb) / (maxDb - minDb)) * ih

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1
    ctx.font = '10px "IBM Plex Mono", monospace'
    ctx.textAlign = 'right'
    for (let db = -100; db <= 0; db += 20) {
      ctx.beginPath()
      ctx.moveTo(padL, y(db))
      ctx.lineTo(width - padR, y(db))
      ctx.stroke()
      ctx.fillText(`${db}`, padL - 5, y(db) + 3)
    }
    ctx.textAlign = 'center'
    for (const f of [100, 1000, 5000, 10000, 20000]) {
      if (f < minF || f > maxF) continue
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x(f), height - 6)
    }

    // Kurve
    const grad = ctx.createLinearGradient(0, padT, 0, height - padB)
    grad.addColorStop(0, 'rgba(163, 230, 53, 0.25)')
    grad.addColorStop(1, 'rgba(163, 230, 53, 0.02)')
    ctx.beginPath()
    ctx.moveTo(x(spectrum[0].hz), y(Math.max(minDb, spectrum[0].db)))
    for (const p of spectrum) {
      ctx.lineTo(x(p.hz), y(Math.max(minDb, Math.min(maxDb, p.db))))
    }
    ctx.lineTo(x(maxF), y(minDb))
    ctx.lineTo(x(minF), y(minDb))
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    ctx.beginPath()
    ctx.moveTo(x(spectrum[0].hz), y(Math.max(minDb, spectrum[0].db)))
    for (const p of spectrum) {
      ctx.lineTo(x(p.hz), y(Math.max(minDb, Math.min(maxDb, p.db))))
    }
    ctx.strokeStyle = '#a3e635'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Cutoff-Marker
    if (cutoffHz && cutoffHz > minF && cutoffHz < maxF) {
      ctx.strokeStyle = '#f87171'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(x(cutoffHz), padT)
      ctx.lineTo(x(cutoffHz), height - padB)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#f87171'
      ctx.textAlign = 'left'
      ctx.fillText(`${(cutoffHz / 1000).toFixed(1)} kHz`, x(cutoffHz) + 4, padT + 9)
    }
  }, [spectrum, cutoffHz, height])

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-background/60">
      <canvas ref={canvasRef} role="img" aria-label="Frequency spectrum of the track" />
    </div>
  )
}
