import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrackAnalysis } from '@/types/audio'
import { analyzeFile } from '@/lib/analyzeFile'

const STORAGE_KEY = 'trackscope-analyses-v1'
const MAX_STORED = 200
const ACCEPTED = ['wav', 'wave', 'mp3', 'flac', 'aif', 'aiff', 'aifc', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'mp4']

type StoredTrack = Omit<TrackAnalysis, 'spectrogram'>

function loadStored(): TrackAnalysis[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredTrack[]
    return parsed.map((t) => ({ ...t, spectrogram: null }))
  } catch {
    return []
  }
}

export interface QueueItem {
  id: string
  name: string
  status: 'pending' | 'analyzing' | 'done' | 'error'
  file: File
}

export function useTracks() {
  const [tracks, setTracks] = useState<TrackAnalysis[]>(() => loadStored())
  const [queue, setQueue] = useState<QueueItem[]>([])
  const busyRef = useRef(false)

  // Persistieren (ohne Spektrogramm-Bilder)
  useEffect(() => {
    try {
      const stored: StoredTrack[] = tracks.slice(0, MAX_STORED).map(({ spectrogram: _s, ...rest }) => rest)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    } catch {
      // Speicher voll → still ignorieren
    }
  }, [tracks])

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => ACCEPTED.includes(f.name.split('.').pop()?.toLowerCase() ?? ''))
    if (list.length === 0) return
    setQueue((qs) => [
      ...qs,
      ...list.map((f) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: f.name,
        status: 'pending' as const,
        file: f,
      })),
    ])
  }, [])

  // sequentielle Verarbeitung: ein Track nach dem anderen
  useEffect(() => {
    if (busyRef.current) return
    const next = queue.find((q) => q.status === 'pending')
    if (!next) {
      // fertige Einträge nach kurzer Zeit aufräumen
      if (queue.some((q) => q.status === 'done' || q.status === 'error')) {
        const t = setTimeout(() => setQueue((qs) => qs.filter((q) => q.status === 'pending' || q.status === 'analyzing')), 4000)
        return () => clearTimeout(t)
      }
      return
    }
    busyRef.current = true
    setQueue((qs) => qs.map((q) => (q.id === next.id ? { ...q, status: 'analyzing' } : q)))
    analyzeFile(next.file)
      .then((result) => {
        setTracks((ts) => [result, ...ts.filter((t) => t.id !== result.id)])
        setQueue((qs) => qs.map((q) => (q.id === next.id ? { ...q, status: result.error ? 'error' : 'done' } : q)))
      })
      .finally(() => {
        busyRef.current = false
        setQueue((qs) => [...qs]) // Effekt erneut triggern
      })
  }, [queue])

  const removeTrack = useCallback((id: string) => {
    setTracks((ts) => ts.filter((t) => t.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setTracks([])
    setQueue([])
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch { /* ignore */ }
  }, [])

  return { tracks, queue, addFiles, removeTrack, clearAll }
}
