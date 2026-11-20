# TrackScope

**Catch fake WAVs & re-encodes — before the gig, not after.**

TrackScope is a fully client-side audio quality checker for DJs. It analyzes the bitrate, frequency spectrum and dynamics of every track directly in the browser — no upload, no queue, no limit. MP3s disguised as WAV/FLAC, upsampled "hi-res" files and transcodes with a fake bitrate label become visible at the spectral edge.

Live: https://trackscope-qc.web.app

## Features

- **Fake-lossless detection** — lossless containers (WAV/FLAC/AIFF) whose spectrum ends at a lossy cutoff (~128k / ~192k / ~320k MP3), with source estimate
- **320k fake suspicion** — hard spectral edge just below 21 kHz flags files likely converted from a 320k MP3 (vinyl-rip exception noted)
- **Transcode detection** — MP3s whose bitrate label doesn't match the spectral content
- **Upsampling detection** — "hi-res" files (e.g. 96 kHz) with no energy above 21 kHz
- Container header parsing for WAV, FLAC, AIFF, MP3 (Xing/Info VBR bitrate) and OGG/Opus — AIFF is decoded by a built-in PCM decoder because Chromium can't
- **Metrics** — cutoff frequency, peak/RMS, approximate LUFS, dynamic range, clipping, stereo correlation
- **Visualization** — averaged log-frequency spectrum with cutoff marker + spectrogram per track
- Batch queue, search & filters, CSV/JSON export, localStorage persistence
- 100 % client-side (Web Audio API + custom FFT) — unlimited tracks, nothing leaves the machine

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS · shadcn/ui · custom radix-2 FFT · Web Audio API

## Run locally

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build   # output in dist/
```

## Deploy to Firebase Hosting

```bash
npm run build
firebase deploy --only hosting
```

Config: `firebase.json` + `.firebaserc` (project `trackscope-qc`).

## How the analysis works

1. The file's container header is parsed (RIFF/fmt, FLAC STREAMINFO, AIFF COMM, MP3 frame + Xing header, Ogg Vorbis/Opus identification) to read declared sample rate, bit depth and bitrate.
2. The audio is decoded with the Web Audio API (AIFF falls back to a manual PCM decoder) and analyzed with an STFT (8192-point Hann-windowed FFT).
3. The averaged power spectrum is scanned for a hard shelf — an abrupt >28 dB drop within 250 Hz that stays down, the signature of lossy encoder cutoffs (128k ≈ 16 kHz, 192k ≈ 18 kHz, 320k ≈ 20.5 kHz).
4. For lossless containers, a shelf below 21 kHz means the file was very likely re-encoded from a lossy source; for lossy files, the cutoff maps back to an approximate source bitrate, which is cross-checked against the declared bitrate.
5. Additional metrics (gated loudness approximation, block-level dynamics, full-scale clipping, stereo correlation) feed a composite grade from A to F.
