"use client";

export type BeatGrid = {
  bpm: number;
  beats: number[];
  duration: number;
};

let cachedContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!cachedContext) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    cachedContext = new Ctor();
  }
  return cachedContext;
}

const beatCache = new Map<string, BeatGrid>();

export async function detectBeats(audioUrl: string): Promise<BeatGrid> {
  const cached = beatCache.get(audioUrl);
  if (cached) {
    return cached;
  }

  const ctx = getAudioContext();
  const response = await fetch(audioUrl);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const samples = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;

  const mono = new Float32Array(samples);
  for (let c = 0; c < channels; c += 1) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < samples; i += 1) {
      mono[i] += data[i] / channels;
    }
  }

  const hopMs = 10;
  const hopSize = Math.max(1, Math.floor((sampleRate * hopMs) / 1000));
  const numHops = Math.floor(samples / hopSize);
  const energy = new Float32Array(numHops);
  for (let h = 0; h < numHops; h += 1) {
    let sumSq = 0;
    const start = h * hopSize;
    for (let i = 0; i < hopSize; i += 1) {
      const v = mono[start + i] ?? 0;
      sumSq += v * v;
    }
    energy[h] = Math.sqrt(sumSq / hopSize);
  }

  const onset = new Float32Array(numHops);
  for (let h = 1; h < numHops; h += 1) {
    const diff = energy[h] - energy[h - 1];
    onset[h] = diff > 0 ? diff : 0;
  }

  const smoothed = new Float32Array(numHops);
  for (let h = 0; h < numHops; h += 1) {
    let sum = 0;
    let count = 0;
    for (let k = -1; k <= 1; k += 1) {
      const idx = h + k;
      if (idx >= 0 && idx < numHops) {
        sum += onset[idx];
        count += 1;
      }
    }
    smoothed[h] = sum / count;
  }

  const minBpm = 70;
  const maxBpm = 180;
  const minLag = Math.max(1, Math.floor(60000 / (maxBpm * hopMs)));
  const maxLag = Math.min(numHops - 1, Math.floor(60000 / (minBpm * hopMs)));
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    const limit = numHops - lag;
    for (let i = 0; i < limit; i += 1) {
      score += smoothed[i] * smoothed[i + lag];
    }
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  const beatPeriodSeconds = (bestLag * hopSize) / sampleRate;
  const bpm = Math.round(60 / beatPeriodSeconds);

  let phaseHop = 0;
  let phaseScore = -Infinity;
  for (let offset = 0; offset < bestLag; offset += 1) {
    let score = 0;
    for (let h = offset; h < numHops; h += bestLag) {
      score += smoothed[h];
    }
    if (score > phaseScore) {
      phaseScore = score;
      phaseHop = offset;
    }
  }

  const beats: number[] = [];
  for (let h = phaseHop; h < numHops; h += bestLag) {
    beats.push((h * hopSize) / sampleRate);
  }

  const result: BeatGrid = { bpm, beats, duration };
  beatCache.set(audioUrl, result);
  return result;
}

export function buildBeatPlan(
  beats: number[],
  duration: number,
  slotCount: number,
  beatsPerSlot: number,
): { startSeconds: number[]; durationsSeconds: number[] } {
  if (slotCount === 0 || beats.length === 0) {
    return { startSeconds: [], durationsSeconds: [] };
  }

  const startSeconds: number[] = [];
  const durationsSeconds: number[] = [];
  let beatIndex = 0;

  for (let slot = 0; slot < slotCount; slot += 1) {
    const startBeat = beats[beatIndex] ?? duration;
    const endIdx = beatIndex + beatsPerSlot;
    const endBeat = beats[endIdx] ?? duration;
    startSeconds.push(startBeat);
    durationsSeconds.push(Math.max(0.05, endBeat - startBeat));
    beatIndex = Math.min(endIdx, beats.length - 1);
  }

  return { startSeconds, durationsSeconds };
}
