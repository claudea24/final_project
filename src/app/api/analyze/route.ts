import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AnalysisItem, AnalysisResult } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 120;

type IncomingPhoto = {
  id: string;
  name: string;
  dataUrl: string;
};

type Body = {
  photos: IncomingPhoto[];
  maxPicks?: number;
};

const SCENE_RANK = [
  "landscape",
  "sunset",
  "beach",
  "city",
  "street",
  "food",
  "portrait",
  "group",
  "detail",
  "other",
];

function heuristic(photos: IncomingPhoto[], maxPicks: number, reason: string): AnalysisResult {
  const items: AnalysisItem[] = photos.map((p, i) => ({
    id: p.id,
    name: p.name,
    scene: SCENE_RANK[i % SCENE_RANK.length],
    qualityScore: 0.5 + ((i * 37) % 50) / 100,
    caption: "",
  }));
  return {
    items,
    orderedIds: items.slice(0, Math.min(maxPicks, items.length)).map((it) => it.id),
    source: "heuristic",
    reason,
  };
}

function parseDataUrl(dataUrl: string): { mime: string; ext: string; bytes: Buffer } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const ext =
    mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return { mime, ext, bytes: Buffer.from(match[2], "base64") };
}

async function runClaudeScript(args: string[], maxPicks: number): Promise<string> {
  const scriptPath = path.join(process.cwd(), "scripts", "analyze.sh");
  return new Promise((resolve, reject) => {
    const proc = spawn(scriptPath, args, {
      env: { ...process.env, MAX_PICKS: String(maxPicks) },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`analyze.sh exited ${code}: ${stderr.slice(0, 400)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function analyzeWithClaude(
  photos: IncomingPhoto[],
  maxPicks: number,
): Promise<AnalysisResult> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "montaj-analyze-"));
  try {
    const args: string[] = [];
    for (let i = 0; i < photos.length; i += 1) {
      const photo = photos[i];
      const decoded = parseDataUrl(photo.dataUrl);
      if (!decoded) continue;
      const filePath = path.join(tempDir, `photo-${i}.${decoded.ext}`);
      await writeFile(filePath, decoded.bytes);
      args.push(`id=${photo.id}:${filePath}`);
    }
    if (args.length === 0) {
      throw new Error("No decodable photos.");
    }

    const stdout = await runClaudeScript(args, maxPicks);
    const parsed = JSON.parse(stdout.trim()) as {
      items: { id: string; scene: string; qualityScore: number; caption: string }[];
      orderedIds: string[];
    };

    const nameById = new Map(photos.map((p) => [p.id, p.name]));
    const items: AnalysisItem[] = parsed.items.map((it) => ({
      id: it.id,
      name: nameById.get(it.id) ?? it.id,
      scene: it.scene,
      qualityScore: it.qualityScore,
      caption: it.caption,
    }));
    const validIds = new Set(photos.map((p) => p.id));
    const orderedIds = parsed.orderedIds
      .filter((id) => validIds.has(id))
      .slice(0, maxPicks);

    return { items, orderedIds, source: "claude" };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  const photos = body.photos ?? [];
  const maxPicks = Math.min(Math.max(body.maxPicks ?? 12, 1), 20);

  if (photos.length === 0) {
    return NextResponse.json({
      items: [],
      orderedIds: [],
      source: "heuristic",
    } satisfies AnalysisResult);
  }

  try {
    const result = await analyzeWithClaude(photos, maxPicks);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "claude -p failed";
    return NextResponse.json(
      heuristic(photos, maxPicks, `Claude Code unavailable — ${message}`),
    );
  }
}
