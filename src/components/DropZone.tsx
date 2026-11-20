import { useState } from 'react'
import type { QueueItem } from '@/hooks/useTracks'

interface Props {
  onFiles: (files: FileList | File[]) => void
  queue: QueueItem[]
}

export default function DropZone({ onFiles, queue }: Props) {
  const [dragOver, setDragOver] = useState(false)

  const active = queue.filter((q) => q.status === 'pending' || q.status === 'analyzing')

  return (
    <div
      className={`relative rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all duration-150 ${
        dragOver ? 'border-primary bg-accent/60 scale-[1.01]' : 'border-border bg-card hover:border-muted-foreground/50'
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files)
      }}
    >
      <input
        id="file-input"
        type="file"
        multiple
        accept=".wav,.wave,.mp3,.flac,.aif,.aiff,.aifc,.ogg,.oga,.opus,.m4a,.aac,.mp4,audio/*"
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <svg
        className={`mx-auto mb-4 h-10 w-10 ${dragOver ? 'text-primary' : 'text-muted-foreground'}`}
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        <path d="M9 18V6l10-2v11.5" />
        <circle cx="6.5" cy="18" r="2.5" />
        <circle cx="16.5" cy="15.5" r="2.5" />
      </svg>
      <p className="text-base font-medium">
        Drop tracks here — or{' '}
        <label htmlFor="file-input" className="cursor-pointer text-primary underline-offset-4 hover:underline">
          choose files
        </label>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Unlimited files. WAV · MP3 · FLAC · AIFF · OGG · Opus · M4A — everything is analyzed locally, nothing is uploaded.
      </p>

      {active.length > 0 && (
        <div className="mx-auto mt-5 max-w-md space-y-1.5 text-left">
          {active.slice(0, 5).map((q) => (
            <div key={q.id} className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-xs">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  q.status === 'analyzing' ? 'animate-pulse bg-primary' : 'bg-muted-foreground/60'
                }`}
              />
              <span className="truncate font-data">{q.name}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">
                {q.status === 'analyzing' ? 'analyzing…' : 'queued'}
              </span>
            </div>
          ))}
          {active.length > 5 && (
            <p className="text-xs text-muted-foreground">+ {active.length - 5} more in queue</p>
          )}
        </div>
      )}
    </div>
  )
}
