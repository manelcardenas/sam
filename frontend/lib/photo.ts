/**
 * A phone photo, made small enough to send (docs/plans/meal-plan-phase-1.md §1.2).
 *
 * A 12-megapixel photo is 3–5 MB as a JPEG and a third more as base64 — over
 * the 4.5 MB a Vercel function accepts, and far more than a model needs to read
 * a cookbook page. 1600 px on the long side keeps small print legible and lands
 * around 250–400 KB.
 */

export const LONG_SIDE = 1600;

/** The size that fits within `max` on its long side, never enlarging. */
export function fitWithin(width: number, height: number, max = LONG_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** The photo as a `data:image/jpeg;base64,` URL, resized and with its EXIF rotation applied. */
export async function photoAsDataUrl(file: File, max = LONG_SIDE, quality = 0.82): Promise<string> {
  // `imageOrientation: "from-image"` applies the EXIF rotation, so a portrait
  // photo of a cookbook is not sent lying on its side.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}
