/** A photo is shrunk in the browser to this many bytes or less before it is sent; the server accepts up to ITEM_IMAGE_MAX_BYTES. */
export const PHOTO_TARGET_BYTES = 300 * 1024;
export const PHOTO_MAX_SIDE = 1200;

/** The sizes tried, best first: the longest side in pixels and the JPEG quality. The first result within the target wins. */
export const SHRINK_STEPS: readonly (readonly [number, number])[] = [
  [PHOTO_MAX_SIDE, 0.85], [PHOTO_MAX_SIDE, 0.72], [1000, 0.72], [1000, 0.6], [800, 0.6], [640, 0.55], [480, 0.5],
];

/** The size a picture of `w` x `h` is drawn at when its longest side may be `side` pixels; never larger than the original. */
export function fitSize(w: number, h: number, side: number): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Shrinks a phone photo (often several MB) to a web-sized JPEG of at most `target` bytes, in the browser. Tries smaller sizes and
 * lower quality until it fits; null when the file is not a picture the browser can read or nothing fits. A picture already small
 * enough is still re-encoded, which also drops its location data.
 */
export async function shrinkPhoto(file: File, target = PHOTO_TARGET_BYTES): Promise<File | null> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return null; }
  let last: Blob | null = null;
  for (const [side, quality] of SHRINK_STEPS) {
    const { width, height } = fitSize(bitmap.width, bitmap.height, side);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; // a transparent png would turn black as a jpeg
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return null;
    last = blob;
    if (blob.size <= target) break;
  }
  bitmap.close?.();
  if (!last) return null;
  return new File([last], "photo.jpg", { type: "image/jpeg" });
}
