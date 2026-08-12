import { EVENT } from "@/lib/shop/waitlist";
import { WAX_SEAL, WORDMARK } from "./art";

/**
 * Draws the confirmation stub as a standalone PNG, for showing at the door.
 *
 * Painted onto a canvas rather than rasterising the DOM node. A
 * `html2canvas`-style capture is the obvious route and the wrong one here: it
 * would add a dependency, and the thing it is worst at is exactly what this
 * stub is made of — `next/font` faces, layered gradients, `clip-path`, a
 * `background` scalloped edge. Those come out approximated or missing. Drawing
 * it by hand costs one file and produces the same picture on every browser, at
 * whatever resolution we ask for.
 *
 * It is also a different composition on purpose: the on-screen stub sits in a
 * page that supplies the branding around it, while this has to identify itself
 * on a stranger's phone, so it carries the wordmark and the venue line.
 */

/** Logical design size. Everything below is in these units. */
const W = 560;
const H = 700;
const PAD = 44;

/** Rendered at 2× so it stays sharp when a phone shows it full-screen. */
const SCALE = 2;

const INK = "#3a2229";
const ROSE = "#a8455f";
const MUTED = "rgba(58,34,41,.58)";
const FAINT = "rgba(58,34,41,.42)";
const HAIRLINE = "rgba(168,69,95,.16)";

export interface TicketData {
  position: number;
  handleLabel: string;
  craftLabel: string;
}

interface Faces {
  display: string;
  mono: string;
  body: string;
}

/**
 * The real family names behind the CSS variables.
 *
 * `next/font` generates them at build time (`__Cormorant_Garamond_e1f2a3`), so
 * they cannot be written as literals — they are read back off the element that
 * carries the variables. Canvas will silently fall back to the generic if a
 * face has not finished loading, hence the explicit `fonts.load` for every
 * weight and size this file actually draws with.
 */
async function resolveFaces(root: HTMLElement): Promise<Faces> {
  const cs = getComputedStyle(root);
  const pick = (name: string, fallback: string) =>
    cs.getPropertyValue(name).trim() || fallback;

  const faces: Faces = {
    display: pick("--font-wl-display", "Georgia, serif"),
    mono: pick("--font-wl-mono", "ui-monospace, monospace"),
    body: pick("--font-wl-body", "system-ui, sans-serif"),
  };

  try {
    await document.fonts.ready;
    await Promise.all(
      [
        `600 56px ${faces.display}`,
        `700 36px ${faces.display}`,
        `400 11px ${faces.mono}`,
        `400 15px ${faces.body}`,
      ].map((f) => document.fonts.load(f).catch(() => undefined))
    );
  } catch {
    // No FontFaceSet (or it refused): the generic fallbacks still draw.
  }

  return faces;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // Same-origin files from /public, so the canvas is never tainted and
    // `toBlob` stays available.
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** `letterSpacing` is recent; assigning it where unsupported is a no-op. */
function setTracking(ctx: CanvasRenderingContext2D, value: string) {
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
    value;
}

/**
 * Draws text shrunk to fit, and elided if shrinking is not enough.
 *
 * An Instagram handle can be thirty characters and the column it sits in is
 * 150 wide — without this, "under" runs straight through "craft".
 */
function drawFitted(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  weight: number,
  size: number,
  family: string,
  minSize = 15
) {
  let px = size;
  ctx.font = `${weight} ${px}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && px > minSize) {
    px -= 1;
    ctx.font = `${weight} ${px}px ${family}`;
  }

  let out = text;
  if (ctx.measureText(out).width > maxWidth) {
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
      out = out.slice(0, -1);
    }
    out += "…";
  }
  ctx.fillText(out, x, y);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * A barcode derived from the queue number.
 *
 * Decorative — it encodes nothing a scanner would read — but deterministic, so
 * the same seat always produces the same bars. A random pattern would change
 * every time the button was pressed, which is the kind of detail that makes a
 * pass look fake next to the one the person beside you downloaded.
 */
function drawBarcode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number
) {
  ctx.save();
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.78;

  // xorshift, so the walk is stable for a given seat and does not repeat.
  let s = (seed * 2654435761) >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };

  let cx = x;
  while (cx < x + w) {
    const bar = 1 + Math.floor(next() * 4);
    const gap = 2 + Math.floor(next() * 4);
    if (cx + bar > x + w) break;
    ctx.fillRect(cx, y, bar, h);
    cx += bar + gap;
  }
  ctx.restore();
}

/** Paints the whole ticket into a canvas at 2×. */
async function render(
  root: HTMLElement,
  data: TicketData
): Promise<HTMLCanvasElement> {
  const faces = await resolveFaces(root);
  const [wordmark, seal] = await Promise.all([
    loadImage(WORDMARK.src),
    loadImage(WAX_SEAL.src),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";

  /* ---- card ------------------------------------------------------------- */
  const paper = ctx.createLinearGradient(0, 0, 0, H);
  paper.addColorStop(0, "#fffdf9");
  paper.addColorStop(1, "#fff4f8");
  roundedRect(ctx, 0, 0, W, H, 22);
  ctx.fillStyle = paper;
  ctx.fill();

  /* ---- wordmark --------------------------------------------------------- */
  if (wordmark) {
    const mw = 208;
    const mh = (mw * WORDMARK.height) / WORDMARK.width;
    ctx.drawImage(wordmark, (W - mw) / 2, 38, mw, mh);
  }

  /* ---- eyebrow ---------------------------------------------------------- */
  setTracking(ctx, "0.28em");
  ctx.font = `400 11px ${faces.mono}`;
  ctx.fillStyle = ROSE;
  ctx.fillText("ADMIT ONE", PAD, 194);
  setTracking(ctx, "0px");

  /* ---- title ------------------------------------------------------------ */
  ctx.fillStyle = INK;
  ctx.font = `600 56px ${faces.display}`;
  ctx.fillText("You’re on", PAD, 250);
  ctx.fillText("the list.", PAD, 302);

  /* ---- body ------------------------------------------------------------- */
  ctx.fillStyle = MUTED;
  ctx.font = `400 15px ${faces.body}`;
  ctx.fillText("We sealed your letter. Watch your inbox —", PAD, 344);
  ctx.fillText("and your DMs — for the address.", PAD, 366);

  /* ---- stats ------------------------------------------------------------ */
  /*
    Three columns across the 472pt of content width, each capped at 148 with a
    16pt gutter. The cap is what stops a thirty-character Instagram handle
    running into "craft" — `drawFitted` shrinks it, then elides it if shrinking
    is not enough.
  */
  const COL_W = 148;
  const cols: [string, string, number][] = [
    ["IN LINE", `#${data.position}`, PAD],
    ["UNDER", data.handleLabel, PAD + COL_W + 16],
    ["CRAFT", data.craftLabel, PAD + (COL_W + 16) * 2],
  ];
  for (const [label, value, x] of cols) {
    setTracking(ctx, "0.22em");
    ctx.font = `400 10px ${faces.mono}`;
    ctx.fillStyle = FAINT;
    ctx.fillText(label, x, 424);
    setTracking(ctx, "0px");

    ctx.fillStyle = INK;
    drawFitted(ctx, value, x, 462, COL_W, 700, 34, faces.display, 14);
  }

  /* ---- perforation ------------------------------------------------------ */
  const perfY = 516;
  // Real notches: punched out of the card so the PNG's alpha carries them,
  // which is what makes it read as a torn stub rather than a rectangle with a
  // line across it.
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  for (const cx of [0, W]) {
    ctx.beginPath();
    ctx.arc(cx, perfY, 13, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(PAD - 20, perfY);
  ctx.lineTo(W - PAD + 20, perfY);
  ctx.stroke();
  ctx.restore();

  /* ---- foot: when, where, and the seal ---------------------------------- */
  setTracking(ctx, "0.2em");
  ctx.font = `400 11px ${faces.mono}`;
  ctx.fillStyle = FAINT;
  ctx.fillText(EVENT.dateLine.toUpperCase(), PAD, 570);
  setTracking(ctx, "0px");

  drawBarcode(ctx, PAD, 596, 200, 44, data.position);

  if (seal) {
    const sw = 92;
    const sh = (sw * WAX_SEAL.height) / WAX_SEAL.width;
    ctx.drawImage(seal, W - PAD - sw, 570, sw, sh);
  }

  /* ---- border, last, so it sits over everything ------------------------- */
  roundedRect(ctx, 0.75, 0.75, W - 1.5, H - 1.5, 22);
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  return canvas;
}

/**
 * Renders the stub and hands it to the browser as a download.
 *
 * Throws rather than reporting, so the caller owns what the failure looks like.
 */
export async function downloadTicket(
  root: HTMLElement,
  data: TicketData
): Promise<void> {
  const canvas = await render(root, data);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );
  if (!blob) throw new Error("Could not encode the ticket");

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `summer-sands-ticket-${data.position}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next frame: Safari abandons the download if the URL dies
  // in the same tick as the click.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
