import type { TrackAnalysis } from '@/types/audio'
import { formatBytes, formatDuration, verdictTone } from '@/lib/grade'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import SpectrumChart from './SpectrumChart'

interface Props {
  track: TrackAnalysis | null
  onClose: () => void
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/50 px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-data text-sm font-medium">{value}</div>
      {sub && <div className="font-data text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

export default function TrackDetail({ track, onClose }: Props) {
  return (
    <Sheet open={track !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {track && (
          <div className="space-y-6 pr-2">
            <SheetHeader>
              <SheetTitle className="break-all text-left leading-snug">{track.fileName}</SheetTitle>
              <SheetDescription asChild>
                <div className="text-left">
                  <span
                    className={`font-medium ${
                      verdictTone(track.verdict) === 'good'
                        ? 'text-primary'
                        : verdictTone(track.verdict) === 'bad'
                          ? 'text-red-300'
                          : 'text-yellow-300'
                    }`}
                  >
                    {track.verdictLabel}
                  </span>
                  {' · '}
                  Grade {track.grade} · Score {track.score}/100
                </div>
              </SheetDescription>
            </SheetHeader>

            <p className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm leading-relaxed">
              {track.verdictDetail}
            </p>

            {track.issues.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Issues</h3>
                <ul className="space-y-1.5">
                  {track.issues.map((issue, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-red-200">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Frequency Spectrum <span className="normal-case text-muted-foreground/70">(averaged, cutoff marked)</span>
              </h3>
              <SpectrumChart spectrum={track.spectrum} cutoffHz={track.metrics.cutoffHz} />
            </div>

            {track.spectrogram && (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Spectrogram <span className="normal-case text-muted-foreground/70">(time × frequency, log)</span>
                </h3>
                <img
                  src={track.spectrogram}
                  alt={`Spectrogram of ${track.fileName}`}
                  className="w-full rounded-lg border border-border"
                />
              </div>
            )}

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">File & Codec</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Metric label="Container" value={track.container.format.toUpperCase()} sub={track.container.isLosslessContainer ? 'lossless' : 'lossy'} />
                <Metric label="Size" value={formatBytes(track.metrics.fileSizeBytes)} />
                <Metric label="Duration" value={formatDuration(track.metrics.durationSec)} />
                <Metric
                  label="Sample Rate (declared)"
                  value={track.container.declaredSampleRate ? `${(track.container.declaredSampleRate / 1000).toFixed(1)} kHz` : '—'}
                  sub={`decoded: ${track.metrics.sampleRate ? `${(track.metrics.sampleRate / 1000).toFixed(1)} kHz` : '—'}`}
                />
                <Metric label="Bit Depth" value={track.container.declaredBitsPerSample ? `${track.container.declaredBitsPerSample} bit` : '—'} />
                <Metric
                  label="Bitrate"
                  value={track.container.declaredBitrateKbps ? `${track.container.declaredBitrateKbps} kbps` : '—'}
                  sub={track.container.estimatedBitrateKbps ? `effective ~${track.container.estimatedBitrateKbps} kbps` : undefined}
                />
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Audio Metrics</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Metric label="Cutoff Frequency" value={track.metrics.cutoffHz ? `${(track.metrics.cutoffHz / 1000).toFixed(2)} kHz` : '—'} sub={`confidence: ${track.metrics.cutoffConfidence === 'high' ? 'high' : track.metrics.cutoffConfidence === 'medium' ? 'medium' : 'low'}`} />
                <Metric label="Estimated Source" value={track.metrics.sourceEstimate ?? '—'} />
                <Metric label="Peak" value={`${track.metrics.peakDb.toFixed(1)} dBFS`} />
                <Metric label="RMS" value={`${track.metrics.rmsDb.toFixed(1)} dBFS`} />
                <Metric label="Loudness (≈LUFS)" value={track.metrics.lufsApprox.toFixed(1)} />
                <Metric label="Dynamics (P20–Peak)" value={`${track.metrics.dynamicRangeDb.toFixed(1)} dB`} />
                <Metric label="Clipping" value={`${track.metrics.clippingPercent.toFixed(3)} %`} />
                <Metric
                  label="Stereo Correlation"
                  value={track.metrics.stereoCorrelation != null ? track.metrics.stereoCorrelation.toFixed(3) : '—'}
                  sub={track.metrics.sideMidRatioDb != null ? `Side/Mid ${track.metrics.sideMidRatioDb.toFixed(1)} dB` : undefined}
                />
              </div>
            </div>

            <p className="pb-4 text-xs text-muted-foreground">
              Analyzed on {new Date(track.analyzedAt).toLocaleString('en-US')} · fully local in your browser.
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
