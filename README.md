# Montaj

Beat-locked, AI-assisted Instagram-reel editor. Upload travel photos and clips, an AI director picks and orders them into a story, and a CapCut-style timeline at the bottom lets you refine. Live 9:16 preview with transitions, captions, and music that loops to fit any 8–30 s reel.

## Pipeline

1. **Upload** — JPG / PNG / WebP / HEIC photos and MP4 / MOV / M4V clips. HEIC is converted to JPEG client-side. iPhone HEVC video is transcoded to H.264 server-side via `POST /api/transcode-video` (ffmpeg required on `PATH`).
2. **Beat detection** — the browser decodes the chosen soundtrack via Web Audio, computes a 10 ms-hop energy onset envelope, and finds tempo by autocorrelation in the 70–180 BPM band. The grid is cached per track URL.
3. **AI selection** — *Auto-pick* posts each photo (resized to 512 px) to `/api/analyze`, which shells out to `claude -p` headless with a strict JSON schema. Claude scores each photo (scene + quality + caption) and returns a story arc (hook → build → climax → outro). On failure the route falls back to a heuristic ordering and surfaces the reason in the UI.
4. **Edit** — drag clips to reorder; drag the left edge of a video to *front-trim*, the right edge to *tail-trim* (one-beat snap, 44 px / beat). A 3-segment grey/green/grey filmstrip on each video shows where the active range sits in the source. *Auto-fit* distributes a target reel length 8–30 s evenly across all clips.
5. **Preview** — Remotion Player at 1080 × 1920, 30 fps. Ken-Burns motion on photos, transitions cycling fade → slide → wipe between every slot, AI captions rendered as a centered overlay editable inline. Audio loops via Remotion's `<Loop>` so reels longer than the 24 s source keep playing without silence.

## Prerequisites

- **Node.js 20+** and **npm**
- **ffmpeg** and **ffprobe** on `PATH` for the HEVC transcode route (`brew install ffmpeg` on macOS)
- **Claude Code CLI** for the AI selection route (`scripts/analyze.sh` invokes `claude -p`)
- (Optional) Supabase project for persistent uploads

## Run

```bash
npm install
PORT=3737 npm run dev
```

Open <http://localhost:3737>.

Type-check / lint:

```bash
npx tsc --noEmit && npm run lint
```

## Supabase setup (optional)

Copy `.env.example` to `.env.local` and fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_KEY=...
NEXT_PUBLIC_SUPABASE_BUCKET=montaj-media
```

If those vars are missing, uploads still work locally in the browser via blob URLs.

## Stack

Next.js 16 (App Router) · Tailwind 4 · TypeScript · Remotion 4.0.457 (`player` + `transitions`, both pinned) · `@dnd-kit/core` + `@dnd-kit/sortable` · `@supabase/supabase-js` · `heic-to`. Server-side ffmpeg + ffprobe for HEVC transcode. Claude Code CLI for AI scoring.

## Layout

| File | Purpose |
|---|---|
| `src/components/montaj-week-one.tsx` | Main page; owns timeline, player ref, frame state, beat grid, AI status. |
| `src/components/timeline-rail.tsx` | CapCut rail. Drag handles, ghost filmstrip, beat ticks, playhead, click-to-seek. Overlap-aware. |
| `src/components/slideshow-composition.tsx` | Remotion composition. `<Video>` slots with conditional `trimBefore`, looped audio, captions, transitions. |
| `src/lib/beats.ts` | Web Audio onset + autocorrelation BPM detector, cached per track. |
| `src/lib/media.ts` | `TimelineMedia` type, music library, Supabase upload helper, HEIC handling, HEVC transcode call. |
| `src/app/api/analyze/route.ts` | AI scoring. Decodes data URLs, spawns `scripts/analyze.sh`, parses JSON, heuristic fallback. |
| `src/app/api/transcode-video/route.ts` | HEVC → H.264 transcode. Streams upload to `/tmp`, ffprobes codec, returns 204 if H.264, otherwise re-encodes via ffmpeg. |
| `scripts/analyze.sh` | `claude -p` headless wrapper with `--json-schema` and minimal `--system-prompt`. |
| `scripts/gen-music.mjs` | Procedural WAV generator (kick + pad + hat) at 92 / 100 / 112 / 128 BPM. |
| `public/music/*.wav` | Seven 24-s royalty-free demo loops. |

## Documentation

- `PROJECT_PROPOSAL.md` — original design spec and per-week status updates.
- `CLAUDE.md` — project-scoped notes for Claude Code: repo conventions, current active issue with diagnosis playbook, ordered next-steps roadmap, verification commands.
- `summarize.md` — single-file session brief for picking work back up.
