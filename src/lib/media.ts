import { createClient } from "@supabase/supabase-js";
import { heicTo, isHeic } from "heic-to";

export type TimelineMediaKind = "image" | "video";

export type TimelineMedia = {
  id: string;
  name: string;
  size: number;
  src: string;
  kind: TimelineMediaKind;
  durationSeconds?: number;
};

export type MusicTrack = {
  id: string;
  name: string;
  mood: string;
  durationLabel: string;
  description: string;
  src: string;
};

export const MUSIC_LIBRARY: MusicTrack[] = [
  {
    id: "coastline",
    name: "Coastline Loop",
    mood: "Bright",
    durationLabel: "0:24",
    description: "Light pulses for sunny arrival shots and beach panoramas.",
    src: "/music/coastline-loop.wav",
  },
  {
    id: "night-drive",
    name: "Night Drive Loop",
    mood: "Moody",
    durationLabel: "0:24",
    description: "A darker synthetic loop for city lights and evening transitions.",
    src: "/music/night-drive-loop.wav",
  },
  {
    id: "postcard",
    name: "Postcard Loop",
    mood: "Warm",
    durationLabel: "0:24",
    description: "Soft chimes and a gentle bass pulse for recap-style reels.",
    src: "/music/postcard-loop.wav",
  },
];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? "montaj-media";

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

export function getStorageStatus() {
  return {
    configured: Boolean(supabase),
    bucket: SUPABASE_BUCKET,
  };
}

export function formatBytes(bytes: number) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const order = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** order;

  return `${value.toFixed(value >= 10 || order === 0 ? 0 : 1)} ${units[order]}`;
}

function isHeicFile(file: File) {
  if (file.type === "image/heic" || file.type === "image/heif") {
    return true;
  }
  return /\.(heic|heif)$/i.test(file.name);
}

function isVideoFile(file: File) {
  if (file.type.startsWith("video/")) {
    return true;
  }
  return /\.(mov|mp4|m4v|webm)$/i.test(file.name);
}

async function probeVideoDuration(blobUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = blobUrl;
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      resolve(duration);
    };
    video.onerror = () => resolve(0);
  });
}

type PreparedMedia = {
  timeline: TimelineMedia;
  uploadFile: File;
};

async function prepareFile(file: File): Promise<PreparedMedia> {
  if (await isHeic(file).catch(() => isHeicFile(file))) {
    const converted = await heicTo({
      blob: file,
      type: "image/jpeg",
      quality: 0.9,
    });
    const jpegName = file.name.replace(/\.(heic|heif)$/i, ".jpg");
    const jpegFile = new File([converted], jpegName, {
      type: "image/jpeg",
    });
    return {
      uploadFile: jpegFile,
      timeline: {
        id: crypto.randomUUID(),
        name: jpegName,
        size: jpegFile.size,
        src: URL.createObjectURL(jpegFile),
        kind: "image",
      },
    };
  }

  if (isVideoFile(file)) {
    const src = URL.createObjectURL(file);
    const durationSeconds = await probeVideoDuration(src);
    return {
      uploadFile: file,
      timeline: {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        src,
        kind: "video",
        durationSeconds,
      },
    };
  }

  return {
    uploadFile: file,
    timeline: {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      src: URL.createObjectURL(file),
      kind: "image",
    },
  };
}

export async function uploadFilesToSupabase(files: FileList | File[]) {
  return uploadFileArrayToSupabase(Array.from(files));
}

export async function uploadFileArrayToSupabase(files: File[]) {
  const prepared = await Promise.all(files.map(prepareFile));
  const timeline = prepared.map((p) => p.timeline);

  if (!supabase) {
    return timeline;
  }

  await Promise.all(
    prepared.map(async ({ uploadFile }) => {
      const key = `${Date.now()}-${crypto.randomUUID()}-${uploadFile.name}`;
      const { error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(key, uploadFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (error) {
        throw new Error(`Supabase upload failed: ${error.message}`);
      }
    }),
  );

  return timeline;
}
