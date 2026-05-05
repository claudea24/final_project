"use client";

import { useEffect, useMemo, useState } from "react";
import { Player } from "@remotion/player";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SlideshowComposition } from "@/components/slideshow-composition";
import {
  MUSIC_LIBRARY,
  type MusicTrack,
  type TimelineMedia,
  formatBytes,
  getStorageStatus,
  uploadFilesToSupabase,
} from "@/lib/media";
import { detectBeats, type BeatGrid } from "@/lib/beats";
import { imageSrcToDataUrl } from "@/lib/photo-thumb";
import type { AnalysisResult } from "@/lib/ai";

const FPS = 30;
const FALLBACK_SECONDS_PER_IMAGE = 1;
const TRANSITION_FRAMES = 12;

export function MontajWeekOne() {
  const [timeline, setTimeline] = useState<TimelineMedia[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<MusicTrack>(MUSIC_LIBRARY[0]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>(
    getStorageStatus().configured
      ? "Supabase storage is configured. Uploaded images will also be persisted."
      : "Supabase storage is not configured yet. Images will stay local in the browser for the demo.",
  );

  const [beatGrid, setBeatGrid] = useState<BeatGrid | null>(null);
  const [beatStatusByTrack, setBeatStatusByTrack] = useState<
    Record<string, "running" | "ok" | "error">
  >({});
  const beatStatus: "idle" | "running" | "ok" | "error" =
    beatStatusByTrack[selectedTrack.src] ?? "idle";
  const [syncToBeat, setSyncToBeat] = useState(true);
  const [beatsPerSlot, setBeatsPerSlot] = useState(1);

  const [aiStatus, setAiStatus] = useState<"idle" | "running" | "ok" | "error">("idle");
  const [aiMessage, setAiMessage] = useState<string>(
    "Auto-pick will score each photo, suggest captions, and order them into a story arc.",
  );

  useEffect(() => {
    let cancelled = false;
    const trackSrc = selectedTrack.src;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBeatStatusByTrack((current) =>
      current[trackSrc] === "running" ? current : { ...current, [trackSrc]: "running" },
    );
    detectBeats(trackSrc)
      .then((grid) => {
        if (cancelled) return;
        setBeatGrid(grid);
        setBeatStatusByTrack((current) => ({ ...current, [trackSrc]: "ok" }));
      })
      .catch(() => {
        if (cancelled) return;
        setBeatStatusByTrack((current) => ({ ...current, [trackSrc]: "error" }));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTrack.src]);

  const perSlotFrames = useMemo(() => {
    if (timeline.length === 0) return [] as number[];
    const beatPeriod =
      beatGrid && beatGrid.bpm > 0 ? 60 / beatGrid.bpm : null;

    return timeline.map((item) => {
      if (item.kind === "video" && item.durationSeconds && item.durationSeconds > 0) {
        return Math.max(1, Math.round(item.durationSeconds * FPS));
      }
      if (syncToBeat && beatPeriod) {
        return Math.max(1, Math.round(beatPeriod * beatsPerSlot * FPS));
      }
      return Math.max(1, Math.round(FALLBACK_SECONDS_PER_IMAGE * FPS));
    });
  }, [timeline, beatGrid, syncToBeat, beatsPerSlot]);

  const totalFrames = useMemo(() => {
    if (perSlotFrames.length === 0) return 0;
    let sum = perSlotFrames.reduce((acc, n) => acc + n, 0);
    for (let i = 0; i < perSlotFrames.length - 1; i += 1) {
      const overlap = Math.max(
        2,
        Math.min(
          TRANSITION_FRAMES,
          Math.floor(perSlotFrames[i] / 2),
          Math.floor(perSlotFrames[i + 1] / 2),
        ),
      );
      sum -= overlap;
    }
    return sum;
  }, [perSlotFrames]);
  const durationInFrames = Math.max(totalFrames, FPS * 5);

  const totalSize = useMemo(
    () => timeline.reduce((sum, item) => sum + item.size, 0),
    [timeline],
  );
  const videoCount = timeline.filter((item) => item.kind === "video").length;

  const captions = useMemo(
    () => timeline.map((item) => item.caption ?? ""),
    [timeline],
  );

  function removeItem(id: string) {
    setTimeline((current) => {
      const removed = current.find((it) => it.id === id);
      if (removed?.src.startsWith("blob:")) {
        URL.revokeObjectURL(removed.src);
      }
      return current.filter((it) => it.id !== id);
    });
  }

  function setCaption(id: string, text: string) {
    setTimeline((current) =>
      current.map((it) => (it.id === id ? { ...it, caption: text } : it)),
    );
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setStatusMessage("Preparing your upload...");

    try {
      const nextTimeline = await uploadFilesToSupabase(files);
      setTimeline((current) => [...current, ...nextTimeline]);

      setStatusMessage(
        getStorageStatus().configured
          ? `Added ${nextTimeline.length} item${nextTimeline.length === 1 ? "" : "s"} and synced them to Supabase Storage.`
          : `Added ${nextTimeline.length} item${nextTimeline.length === 1 ? "" : "s"} locally. Add Supabase env vars when you want persistence.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      setStatusMessage(message);
    } finally {
      setIsUploading(false);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setTimeline((current) => {
      const oldIndex = current.findIndex((it) => it.id === active.id);
      const newIndex = current.findIndex((it) => it.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
  }

  async function runAIAnalysis() {
    const photos = timeline.filter((it) => it.kind === "image");
    if (photos.length === 0) {
      setAiStatus("error");
      setAiMessage("Add some photos first.");
      return;
    }

    setAiStatus("running");
    setAiMessage(`Analyzing ${photos.length} photo${photos.length === 1 ? "" : "s"}...`);

    try {
      const dataUrls = await Promise.all(
        photos.map(async (p) => ({ id: p.id, name: p.name, dataUrl: await imageSrcToDataUrl(p.src) })),
      );
      const usable = dataUrls.filter((d): d is { id: string; name: string; dataUrl: string } => Boolean(d.dataUrl));

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: usable, maxPicks: 12 }),
      });

      if (!response.ok) {
        throw new Error(`API ${response.status}`);
      }

      const result = (await response.json()) as AnalysisResult;
      const itemById = new Map(result.items.map((it) => [it.id, it]));

      setTimeline((current) => {
        const enriched = current.map((it) => {
          const meta = itemById.get(it.id);
          if (!meta) return it;
          return {
            ...it,
            caption: it.caption ?? meta.caption,
            scene: meta.scene,
            qualityScore: meta.qualityScore,
          };
        });

        if (result.orderedIds.length === 0) return enriched;

        const orderIndex = new Map(result.orderedIds.map((id, i) => [id, i]));
        return [...enriched].sort((a, b) => {
          const ai = orderIndex.has(a.id) ? orderIndex.get(a.id)! : Number.POSITIVE_INFINITY;
          const bi = orderIndex.has(b.id) ? orderIndex.get(b.id)! : Number.POSITIVE_INFINITY;
          if (ai !== bi) return ai - bi;
          return 0;
        });
      });

      setAiStatus("ok");
      if (result.source === "claude") {
        setAiMessage(
          `Claude Code ranked ${result.items.length} photos and arranged ${result.orderedIds.length} into a narrative.`,
        );
      } else {
        setAiMessage(
          result.reason ??
            "Claude Code wasn't reachable — used a placeholder ordering. Make sure `claude` is on the server's PATH.",
        );
      }
    } catch (error) {
      setAiStatus("error");
      setAiMessage(error instanceof Error ? error.message : "Analysis failed.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-4 py-8 md:px-8">
      <section className="grid gap-4 rounded-[32px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow)] backdrop-blur md:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-4">
          <p className="text-sm uppercase tracking-[0.3em] text-[var(--accent)]">
            Montaj / Weeks 1–3
          </p>
          <h1 className="max-w-3xl text-4xl leading-tight md:text-6xl">
            Beat-synced reels with AI selection, drag-and-drop edits, and AI captions.
          </h1>
          <p className="max-w-2xl text-base leading-7 text-[var(--muted)] md:text-lg">
            Upload trip photos and clips. Photos snap to the soundtrack&apos;s beat,
            AI picks the best ones and orders them into a story, and you can drag,
            caption, and refine in the browser.
          </p>
        </div>

        <div className="grid gap-3 rounded-[24px] border border-[var(--line)] bg-white/70 p-5">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--accent-strong)]">
            Status
          </p>
          {[
            ["Photo upload + Remotion preview", "Week 1"],
            ["Ken Burns + reorder controls", "Week 1"],
            ["Beat-synced timing", "Week 2"],
            ["AI selection + ordering", "Week 2"],
            ["Drag-and-drop timeline", "Week 3"],
            ["AI captions (editable)", "Week 3"],
          ].map(([label, badge]) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-2xl bg-[#f7f4ec] px-4 py-3"
            >
              <span>{label}</span>
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
                {badge}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="grid gap-6">
          <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl">Upload photos & clips</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  Drag in JPG, PNG, WebP, or HEIC photos and MOV/MP4 clips. Photos
                  snap to the beat; clips play their full length.
                </p>
              </div>
              <label className="cursor-pointer rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]">
                Choose files
                <input
                  accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif,video/quicktime,video/mp4,.mov,.mp4,.m4v"
                  className="hidden"
                  multiple
                  type="file"
                  onChange={(event) => void handleFiles(event.target.files)}
                />
              </label>
            </div>

            <div
              className={`mt-5 rounded-[24px] border-2 border-dashed px-6 py-10 text-center transition ${
                isDragging
                  ? "border-[var(--accent)] bg-[#eef9f7]"
                  : "border-[var(--line)] bg-white/60"
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                void handleFiles(event.dataTransfer.files);
              }}
            >
              <p className="text-lg">Drop travel photos and clips here</p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {isUploading ? "Uploading..." : "Or use the file picker above."}
              </p>
            </div>

            <p className="mt-4 rounded-2xl bg-[#f7f4ec] px-4 py-3 text-sm leading-6 text-[var(--muted)]">
              {statusMessage}
            </p>
          </section>

          <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow)]">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl">Soundtrack & beat sync</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  Pick a track. Beat detection runs in the browser; photos snap
                  to its beat grid.
                </p>
              </div>
              <span className="rounded-full bg-[#f7f4ec] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-strong)]">
                {selectedTrack.mood}
              </span>
            </div>

            <div className="mt-5 grid gap-3">
              {MUSIC_LIBRARY.map((track) => {
                const active = track.id === selectedTrack.id;
                return (
                  <button
                    key={track.id}
                    className={`rounded-[22px] border px-4 py-4 text-left transition ${
                      active
                        ? "border-[var(--accent)] bg-[#eef9f7]"
                        : "border-[var(--line)] bg-white/60 hover:border-[var(--accent)]"
                    }`}
                    type="button"
                    onClick={() => setSelectedTrack(track)}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-lg">{track.name}</p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {track.description}
                        </p>
                      </div>
                      <span className="text-sm text-[var(--muted)]">
                        {track.durationLabel}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <audio
              key={selectedTrack.id}
              className="mt-5 w-full"
              controls
              src={selectedTrack.src}
            />

            <div className="mt-5 grid gap-3 rounded-2xl bg-[#f7f4ec] px-4 py-3 text-sm leading-6 text-[var(--muted)]">
              <div className="flex items-center justify-between">
                <span>Detected BPM</span>
                <span className="font-semibold text-[var(--accent-strong)]">
                  {beatStatus === "running"
                    ? "analyzing..."
                    : beatStatus === "error"
                      ? "could not detect"
                      : beatGrid
                        ? `${beatGrid.bpm} (${beatGrid.beats.length} beats)`
                        : "—"}
                </span>
              </div>
              <label className="flex items-center justify-between gap-3">
                <span>Sync photos to beat</span>
                <input
                  checked={syncToBeat}
                  onChange={(e) => setSyncToBeat(e.target.checked)}
                  type="checkbox"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>Beats per photo</span>
                <input
                  className="w-40"
                  disabled={!syncToBeat}
                  max={4}
                  min={1}
                  onChange={(e) => setBeatsPerSlot(Number(e.target.value))}
                  step={1}
                  type="range"
                  value={beatsPerSlot}
                />
                <span className="w-6 text-right font-semibold text-[var(--accent-strong)]">
                  {beatsPerSlot}
                </span>
              </label>
            </div>
          </section>

          <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow)]">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl">AI creative director</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  Score photos, suggest captions, and arrange them into a hook →
                  build → climax → outro.
                </p>
              </div>
              <button
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-50"
                disabled={aiStatus === "running" || timeline.length === 0}
                onClick={() => void runAIAnalysis()}
                type="button"
              >
                {aiStatus === "running" ? "Analyzing..." : "Auto-pick & order"}
              </button>
            </div>
            <p className="mt-4 rounded-2xl bg-[#f7f4ec] px-4 py-3 text-sm leading-6 text-[var(--muted)]">
              {aiMessage}
            </p>
          </section>
        </div>

        <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow)]">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl">Preview & timeline</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Beat-synced Remotion preview. Drag rows to reorder, edit captions
                inline, or remove a slot.
              </p>
            </div>
            <div className="rounded-[24px] bg-[#f7f4ec] px-4 py-3 text-sm leading-6 text-[var(--muted)]">
              <p>
                {timeline.length - videoCount} photos · {videoCount} clips
              </p>
              <p>{formatBytes(totalSize)}</p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-[24px] border border-[var(--line)] bg-[#1e293b]">
            <Player
              acknowledgeRemotionLicense
              autoPlay
              controls
              component={SlideshowComposition}
              compositionWidth={1080}
              compositionHeight={1920}
              durationInFrames={durationInFrames}
              fps={FPS}
              inputProps={{
                images:
                  timeline.length > 0
                    ? timeline
                    : [
                        {
                          id: "placeholder",
                          name: "Placeholder",
                          size: 0,
                          src: "/placeholder/postcard.svg",
                          kind: "image" as const,
                        },
                      ],
                soundtrackSrc: selectedTrack.src,
                perSlotFrames: timeline.length > 0 ? perSlotFrames : undefined,
                fallbackSecondsPerImage: FALLBACK_SECONDS_PER_IMAGE,
                captions: timeline.length > 0 ? captions : undefined,
                transitionFrames: TRANSITION_FRAMES,
              }}
              style={{ width: "100%", aspectRatio: "9 / 16" }}
            />
          </div>

          <TimelineList
            timeline={timeline}
            onDragEnd={handleDragEnd}
            onRemove={removeItem}
            onCaptionChange={setCaption}
          />
        </section>
      </section>
    </main>
  );
}

type TimelineListProps = {
  timeline: TimelineMedia[];
  onDragEnd: (event: DragEndEvent) => void;
  onRemove: (id: string) => void;
  onCaptionChange: (id: string, text: string) => void;
};

function TimelineList({ timeline, onDragEnd, onRemove, onCaptionChange }: TimelineListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  if (timeline.length === 0) {
    return (
      <div className="mt-5 rounded-[22px] border border-[var(--line)] bg-white/60 p-4 text-sm leading-6 text-[var(--muted)]">
        Add a few travel photos to replace the placeholder postcard and make the
        preview feel real.
      </div>
    );
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      sensors={sensors}
    >
      <SortableContext
        items={timeline.map((it) => it.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="mt-5 grid gap-3">
          {timeline.map((item, index) => (
            <SortableRow
              key={item.id}
              index={index}
              item={item}
              onCaptionChange={onCaptionChange}
              onRemove={onRemove}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

type SortableRowProps = {
  item: TimelineMedia;
  index: number;
  onRemove: (id: string) => void;
  onCaptionChange: (id: string, text: string) => void;
};

function SortableRow({ item, index, onRemove, onCaptionChange }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      className="flex items-center gap-3 rounded-[22px] border border-[var(--line)] bg-white/70 p-3"
      style={style}
    >
      <button
        aria-label="Drag to reorder"
        className="cursor-grab touch-none rounded-lg border border-[var(--line)] bg-white/80 px-2 py-2 text-sm text-[var(--muted)] active:cursor-grabbing"
        type="button"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      {item.kind === "video" ? (
        <video
          className="h-16 w-16 rounded-2xl object-cover"
          muted
          playsInline
          preload="metadata"
          src={item.src}
        />
      ) : (
        <img
          alt={item.name}
          className="h-16 w-16 rounded-2xl object-cover"
          src={item.src}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm">
          <span className="truncate">{item.name}</span>
          {item.scene ? (
            <span className="rounded-full bg-[#eef9f7] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-strong)]">
              {item.scene}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-[var(--muted)]">
          Slot {index + 1}
          {item.kind === "video" && item.durationSeconds
            ? ` · ${item.durationSeconds.toFixed(1)}s clip`
            : ""}
          {typeof item.qualityScore === "number"
            ? ` · q ${item.qualityScore.toFixed(2)}`
            : ""}
        </p>
        <input
          className="mt-2 w-full rounded-lg border border-[var(--line)] bg-white/80 px-2 py-1 text-xs text-[var(--accent-strong)] placeholder:text-[var(--muted)]"
          onChange={(e) => onCaptionChange(item.id, e.target.value)}
          placeholder="Caption (AI will fill these in)"
          type="text"
          value={item.caption ?? ""}
        />
      </div>
      <button
        aria-label="Remove"
        className="rounded-lg border border-[var(--line)] bg-white/80 px-2 py-1 text-xs text-[var(--muted)] hover:text-red-600"
        onClick={() => onRemove(item.id)}
        type="button"
      >
        ✕
      </button>
    </li>
  );
}
