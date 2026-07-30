/**
 * Conditions an image in the browser before it is handed to Storage.
 *
 * Phone and DSLR originals arrive at 3–5 MB and 4000px+ on the long edge; the
 * catalogue's existing uploads average 2.37 MB. None of that reaches a shopper
 * — the CDN resizes on the way out — but the untouched original is still what
 * we pay to store, what the operator waits on over a hotel wifi, and what every
 * transform has to be derived from. Shrinking it here fixes all three at once.
 *
 * Everything is best-effort: if the browser can't decode the file, if the codec
 * is missing, or if the result comes out no smaller, the original File is
 * returned unchanged. An upload must never fail because an optimisation did.
 */

/**
 * Longest edge we keep. The widest rendition anything requests is the 2400px
 * top rung in `next.config.ts`, and Supabase refuses a transform over 2500px
 * anyway — pixels beyond this could never be served to anyone.
 */
const MAX_EDGE = 2400;

/** WebP at this quality is visually lossless for garment photography. */
const QUALITY = 0.82;

/**
 * Left alone on purpose:
 *  - GIF, because a canvas round-trip silently flattens it to a single frame.
 *  - SVG, because it is already resolution-independent and rasterising it loses
 *    exactly what makes it useful.
 */
const PASS_THROUGH = new Set(["image/gif", "image/svg+xml"]);

export interface PreparedUpload {
  file: File;
  /** Intrinsic size after conditioning — the source of truth for the stored asset. */
  width: number;
  height: number;
  /** False when the original was returned untouched. */
  transcoded: boolean;
}

function canvasFor(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function encode(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: "image/webp", quality: QUALITY }).catch(() => null);
  }
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", QUALITY));
}

export async function prepareImageUpload(file: File): Promise<PreparedUpload> {
  const untouched = (width = 0, height = 0): PreparedUpload => ({
    file,
    width,
    height,
    transcoded: false,
  });

  if (!file.type.startsWith("image/") || PASS_THROUGH.has(file.type)) return untouched();

  let bitmap: ImageBitmap;
  try {
    // `from-image` applies the EXIF orientation flag rather than carrying it
    // forward as metadata — without it, photos shot in portrait on a phone land
    // in the bucket rotated, because the CDN transform drops EXIF.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return untouched();
  }

  try {
    const { width: sourceWidth, height: sourceHeight } = bitmap;
    const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);

    const canvas = canvasFor(width, height);
    const context = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context) return untouched(sourceWidth, sourceHeight);

    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await encode(canvas);

    // A file that was already well-optimised can encode *larger* than it
    // started. Keeping whichever is smaller means this is never a regression.
    if (!blob || blob.size >= file.size) return untouched(sourceWidth, sourceHeight);

    const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return {
      file: new File([blob], name, { type: "image/webp", lastModified: file.lastModified }),
      width,
      height,
      transcoded: true,
    };
  } catch {
    return untouched();
  } finally {
    bitmap.close();
  }
}

/**
 * Storage `cacheControl`, in seconds, for assets whose path contains a UUID.
 *
 * Every upload here mints a fresh id, so a given path's bytes never change —
 * re-editing an image writes a new path rather than overwriting an old one.
 * That makes a year safe, and it matters: objects were being stored with the
 * one-hour default, so browsers and the CDN re-fetched unchanged photography
 * all day. The one caller that can overwrite a path is the upload retry, which
 * re-sends the identical file.
 */
export const IMMUTABLE_CACHE_CONTROL = "31536000";
