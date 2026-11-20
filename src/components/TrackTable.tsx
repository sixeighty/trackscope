import type { TrackAnalysis } from '@/types/audio'
import { formatBytes, formatDuration, gradeTone, verdictTone } from '@/lib/grade'

interface Props {
  tracks: TrackAnalysis[]
  onSelect: (track: TrackAnalysis) => void
  onRemove: (id: string) => void
}

function GradeBadge({ grade }: { grade: string }) {
  const tone = gradeTone(grade)
  const cls =
    tone === 'good'
      ? 'bg-primary/15 text-primary border-primary/30'
      : tone === 'mid'
        ? 'bg-yellow-400/10 text-yellow-300 border-yellow-300/30'
        : 'bg-red-400/10 text-red-300 border-red-300/30'
  return (
    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md border font-data text-sm font-semibold ${cls}`}>
      {grade}
    </span>
  )
}

function VerdictChip({ track }: { track: TrackAnalysis }) {
  const tone = verdictTone(track.verdict)
  const cls =
    tone === 'good'
      ? 'text-primary'
      : tone === 'mid'
        ? 'text-yellow-300'
        : tone === 'bad'
          ? 'text-red-300'
          : 'text-muted-foreground'
  return (
    <div>
      <span className={`font-medium ${cls}`}>{track.verdictLabel}</span>
      {track.metrics.cutoffHz != null && (
        <span className="ml-2 font-data text-xs text-muted-foreground">
          @ {Math.round(track.metrics.cutoffHz / 100) / 10} kHz
        </span>
      )}
      {track.issues.length > 0 && (
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{track.issues.join(' · ')}</p>
      )}
    </div>
  )
}

export default function TrackTable({ tracks, onSelect, onRemove }: Props) {
  if (tracks.length === 0) return null

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">Track</th>
            <th className="px-3 py-3 font-medium">Format</th>
            <th className="px-3 py-3 font-medium">Duration</th>
            <th className="px-3 py-3 font-medium">Size</th>
            <th className="px-3 py-3 font-medium">Bitrate</th>
            <th className="px-3 py-3 font-medium">Sample Rate</th>
            <th className="px-3 py-3 font-medium">Verdict</th>
            <th className="px-3 py-3 text-right font-medium">Grade</th>
            <th className="px-3 py-3" aria-label="Aktionen" />
          </tr>
        </thead>
        <tbody>
          {tracks.map((t) => (
            <tr
              key={t.id}
              className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-secondary/60"
              onClick={() => onSelect(t)}
            >
              <td className="max-w-[280px] px-4 py-3">
                <div className="truncate font-medium" title={t.fileName}>
                  {t.fileName}
                </div>
                {t.error && <div className="text-xs text-red-300">{t.error}</div>}
              </td>
              <td className="px-3 py-3">
                <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-data text-xs uppercase">
                  {t.container.format}
                </span>
              </td>
              <td className="px-3 py-3 font-data text-xs">{formatDuration(t.metrics.durationSec)}</td>
              <td className="px-3 py-3 font-data text-xs">{formatBytes(t.metrics.fileSizeBytes)}</td>
              <td className="px-3 py-3 font-data text-xs">
                {t.container.declaredBitrateKbps ? `${t.container.declaredBitrateKbps} k` : '—'}
                <span className="block text-muted-foreground">
                  {t.container.estimatedBitrateKbps ? `~${t.container.estimatedBitrateKbps} k` : ''}
                </span>
              </td>
              <td className="px-3 py-3 font-data text-xs">
                {t.metrics.sampleRate ? `${(t.metrics.sampleRate / 1000).toFixed(1)} kHz` : '—'}
                {t.metrics.channels > 0 && <span className="block text-muted-foreground">{t.metrics.channels === 1 ? 'Mono' : t.metrics.channels === 2 ? 'Stereo' : `${t.metrics.channels}ch`}</span>}
              </td>
              <td className="max-w-[300px] px-3 py-3 text-xs">
                <VerdictChip track={t} />
              </td>
              <td className="px-3 py-3 text-right">
                <GradeBadge grade={t.grade} />
              </td>
              <td className="px-3 py-3 text-right">
                <button
                  type="button"
                  aria-label={`Remove ${t.fileName}`}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(t.id)
                  }}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
