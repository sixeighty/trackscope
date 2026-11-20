import { useMemo, useState } from 'react'
import { useTracks } from '@/hooks/useTracks'
import type { TrackAnalysis } from '@/types/audio'
import { toCsv } from '@/lib/grade'
import DropZone from '@/components/DropZone'
import TrackTable from '@/components/TrackTable'
import TrackDetail from '@/components/TrackDetail'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Filter = 'all' | 'good' | 'mid' | 'bad' | 'issues'

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="font-data text-2xl font-semibold text-primary">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'good', label: 'Passed' },
  { key: 'mid', label: 'Average' },
  { key: 'bad', label: 'Problematic' },
  { key: 'issues', label: 'With Issues' },
]

export default function Home() {
  const { tracks, queue, addFiles, removeTrack, clearAll } = useTracks()
  const [selected, setSelected] = useState<TrackAnalysis | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    let list = tracks
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((t) => t.fileName.toLowerCase().includes(q))
    }
    switch (filter) {
      case 'good':
        list = list.filter((t) => ['genuine-lossless', 'likely-lossless', 'lossy-good'].includes(t.verdict))
        break
      case 'mid':
        list = list.filter((t) => ['lossy-mid', 'unknown'].includes(t.verdict))
        break
      case 'bad':
        list = list.filter((t) => ['fake-lossless', 'lossy-bad', 'transcode-mismatch'].includes(t.verdict))
        break
      case 'issues':
        list = list.filter((t) => t.issues.length > 0)
        break
    }
    return list
  }, [tracks, search, filter])

  const stats = useMemo(() => {
    const good = tracks.filter((t) => ['genuine-lossless', 'likely-lossless', 'lossy-good'].includes(t.verdict)).length
    const bad = tracks.filter((t) => ['fake-lossless', 'lossy-bad', 'transcode-mismatch'].includes(t.verdict)).length
    const fakes = tracks.filter((t) => t.verdict === 'fake-lossless' || t.verdict === 'transcode-mismatch').length
    return { good, bad, fakes }
  }, [tracks])

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-primary" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12h3l2.5-6 3.5 12 3-9 1.8 3H21" />
            </svg>
            <h1 className="text-lg font-semibold tracking-tight">TrackScope</h1>
            <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
              local · offline · unlimited
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={tracks.length === 0}
              onClick={() => download('trackscope-report.csv', toCsv(tracks), 'text/csv;charset=utf-8')}
            >
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={tracks.length === 0}
              onClick={() => download('trackscope-report.json', JSON.stringify(tracks, null, 2), 'application/json')}
            >
              JSON
            </Button>
            <Button variant="ghost" size="sm" disabled={tracks.length === 0} onClick={clearAll}>
              Clear
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-5 py-6">
        <section aria-label="Intro">
          <h2 className="text-2xl font-semibold tracking-tight">Catch fake WAVs &amp; re-encodes — before the gig, not after.</h2>
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
            TrackScope analyzes the bitrate, frequency spectrum and dynamics of every track directly in your browser.
            MP3s disguised as WAV/FLAC, upsampled &ldquo;hi-res&rdquo; files and transcodes with a fake bitrate label become
            visible at the spectral edge. Nothing is ever uploaded — analysis runs entirely locally, and you can check
            as many tracks as you want.
          </p>
        </section>

        {tracks.length > 0 && (
          <section aria-label="Statistics" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Tracks analyzed" value={tracks.length} />
            <Stat label="Passed" value={stats.good} />
            <Stat label="Problematic" value={stats.bad} />
            <Stat label="Fakes & transcodes" value={stats.fakes} />
          </section>
        )}

        <DropZone onFiles={addFiles} queue={queue} />

        {tracks.length > 0 && (
          <section aria-label="Analyzed tracks">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tracks…"
                className="w-full sm:w-64"
                aria-label="Search tracks"
              />
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      filter === f.key
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <span className="ml-auto text-xs text-muted-foreground">
                {filtered.length} of {tracks.length} tracks
              </span>
            </div>
            <TrackTable tracks={filtered} onSelect={setSelected} onRemove={removeTrack} />
          </section>
        )}

        {tracks.length === 0 && queue.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            No tracks analyzed yet. Get started — the first analysis takes only a few seconds per track.
          </p>
        )}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-4 text-xs text-muted-foreground">
          <span>TrackScope — audio quality control for DJs. 100% client-side (Web Audio API).</span>
          <span className="font-data">WAV · MP3 · FLAC · AIFF · OGG · Opus · M4A</span>
        </div>
      </footer>

      <TrackDetail
        track={selected ? tracks.find((t) => t.id === selected.id) ?? selected : null}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
