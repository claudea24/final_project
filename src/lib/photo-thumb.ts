"use client";

const MAX_DIMENSION = 512;

export async function imageSrcToDataUrl(src: string): Promise<string | null> {
  try {
    const img = await loadImage(src);
    const { width, height } = scaleToFit(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

function scaleToFit(w: number, h: number) {
  if (w <= MAX_DIMENSION && h <= MAX_DIMENSION) return { width: w, height: h };
  const ratio = w > h ? MAX_DIMENSION / w : MAX_DIMENSION / h;
  return {
    width: Math.round(w * ratio),
    height: Math.round(h * ratio),
  };
}
