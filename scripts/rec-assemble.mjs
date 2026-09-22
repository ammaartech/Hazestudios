/**
 * Turns the captured frames into the finished video.
 *
 *   node scripts/rec-assemble.mjs [targetSeconds]
 *
 * Three jobs:
 *
 *   1. Retime. A screencast emits frames only when something changes, so the
 *      capture is wildly variable-rate. Each frame gets an explicit duration,
 *      scaled by its section's speed factor, and then the whole thing is
 *      scaled again to land exactly on the target length.
 *   2. Trim dead air. Long gaps between frames are page loads with nothing
 *      happening; they are capped rather than played out.
 *   3. Sound. No music and no narration — only the clicks and keystrokes the
 *      scripted operator actually made, placed at their warped output times.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FF = "C:/Users/Ammaar/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin";
const FFMPEG = join(FF, "ffmpeg.exe");

const OUT = "brag-real";
const FRAMES = join(OUT, "frames");
const TARGET = Number(process.argv[2] ?? 195);
const FPS = 30;
const SR = 48000;

/*
 * How long a single frame may represent.
 *
 * This was 900ms, and it was the wrong instinct. A screencast emits a burst of
 * frames while a page paints its skeleton, then goes quiet once the content is
 * up — so the settled state is ONE frame with a long gap after it. Capping at
 * 900ms threw away that dwell while keeping every skeleton frame, and the
 * admin half of the video came out as loading placeholders stretched over
 * sixteen seconds each.
 *
 * Keeping the real dwell lets the settled frames carry the section, which is
 * what a viewer actually needs to look at.
 */
const MAX_HOLD_MS = 6000;

const SFX_SRC = "brag-output/composition/assets/sfx";
const SFX = {
  click: join(SFX_SRC, "interface/click_003.ogg"),
  key: join(SFX_SRC, "keyboard/keypress-014.wav"),
};

const { frames, events } = JSON.parse(readFileSync(join(OUT, "events.json"), "utf8"));
if (!frames.length) { console.error("no frames captured"); process.exit(1); }

/* ---- 1. budget each section -------------------------------------------- */

/*
 * A single global speed multiplier does not work here. The storefront is one
 * long continuous scroll, which emits a frame for every rendered step, while
 * the admin is mostly navigations separated by idle gaps that get capped. Left
 * to a uniform ramp, the storefront swallowed 148 of the 195 seconds and the
 * admin — the half that matters — got 47.
 *
 * So each section is given an explicit budget and scaled to fit it. The
 * numbers below are the edit: 58s of storefront, 137s of admin.
 */
const BUDGET = {
  "storefront-home": 14,
  collection: 10,
  product: 14,
  cart: 8,
  checkout: 12,

  "admin-home": 10,
  orders: 18,
  "partial-cod": 26,
  couriers: 18,
  products: 18,
  catalogue: 10,
  customers: 10,
  analytics: 16,
  rest: 11,
};

const sectionEvents = events.filter((e) => e.type === "section");
if (!sectionEvents.length) { console.error("no section markers in the log"); process.exit(1); }

// Frame ranges per section.
const bounds = sectionEvents.map((s, i) => ({
  name: s.name,
  from: s.t,
  to: i + 1 < sectionEvents.length ? sectionEvents[i + 1].t : Infinity,
}));

const budgetTotal = Object.values(BUDGET).reduce((a, b) => a + b, 0);
const budgetScale = TARGET / budgetTotal;

/*
 * The admin dashboard never got past its skeletons in the main capture, so it
 * was re-shot on its own (rec-admin-home.mjs) and its frames are swapped in
 * here. They live in a different directory, hence the `dir` on each entry.
 */
const SUB = {
  "admin-home": {
    dir: "frames-adminhome",
    meta: existsSync(join(OUT, "adminhome.json"))
      ? JSON.parse(readFileSync(join(OUT, "adminhome.json"), "utf8")).frames
      : null,
  },
};

const raw = [];
let unbudgeted = 0;

for (const b of bounds) {
  const sub = SUB[b.name]?.meta;
  const src = sub ?? frames;
  const dir = sub ? SUB[b.name].dir : "frames";

  const mine = [];
  for (let i = 0; i < src.length; i++) {
    const t = src[i].t;
    if (!sub && (t < b.from || t >= b.to)) continue;
    const next = i + 1 < src.length ? src[i + 1].t : t + 33;
    mine.push({ i: src[i].i, t, dir, held: Math.min(next - t, MAX_HOLD_MS) / 1000 });
  }
  if (!mine.length) continue;
  if (sub) console.log(`  ${b.name.padEnd(16)} (re-shot separately)`);

  const want = (BUDGET[b.name] ?? 6) * budgetScale;
  if (BUDGET[b.name] === undefined) unbudgeted++;
  const have = mine.reduce((a, f) => a + f.held, 0);
  const k = want / have;
  for (const f of mine) raw.push({ i: f.i, t: f.t, dir: f.dir, dur: f.held * k });

  console.log(
    `  ${b.name.padEnd(16)} ${String(mine.length).padStart(5)} frames  ` +
      `${have.toFixed(1)}s -> ${want.toFixed(1)}s  (x${(1 / k).toFixed(2)})`
  );
}

if (unbudgeted) console.log(`  (${unbudgeted} section(s) had no budget and used the default)`);

const storefront = ["storefront-home", "collection", "product", "cart", "checkout"]
  .reduce((a, n) => a + (BUDGET[n] ?? 0), 0) * budgetScale;
console.log(
  `\ncapture      ${(frames.at(-1).t / 1000).toFixed(1)}s across ${frames.length} frames` +
    `\nstorefront   ${storefront.toFixed(0)}s (${((storefront / TARGET) * 100).toFixed(0)}%)` +
    `\nadmin        ${(TARGET - storefront).toFixed(0)}s (${(((TARGET - storefront) / TARGET) * 100).toFixed(0)}%)`
);

/* Maps a capture timestamp to its position in the finished video, so a click
   is heard at the moment it is seen. */
/*
 * Only the main capture's frames go into this table. The re-shot dashboard
 * carries timestamps from its own session (0–9s), which are wildly out of
 * order next to the main capture's (~490s) — and the binary search below
 * assumes a sorted table. Mixing them silently corrupted every label time
 * after the substitution, which is how "Checkout" ended up captioning the
 * admin dashboard. Substituted frames still consume output time; they just do
 * not define capture→output mapping points.
 */
let acc = 0;
const marks = [];
for (const f of raw) {
  if (f.dir === "frames") marks.push({ t: f.t, out: acc });
  acc += f.dur;
}
function toOutput(t) {
  let lo = 0, hi = marks.length - 1;
  if (t <= marks[0].t) return 0;
  if (t >= marks[hi].t) return marks[hi].out;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (marks[mid].t <= t) lo = mid; else hi = mid;
  }
  return marks[lo].out;
}

/* ---- 3. the concat list -------------------------------------------------- */

// The concat demuxer resolves each path relative to the LIST FILE's directory,
// not the working directory, so these are written relative to brag-real/.
const name = (f) => `${f.dir}/${String(f.i).padStart(6, "0")}.jpg`;

const lines = [];
for (const f of raw) {
  lines.push(`file '${name(f)}'`);
  lines.push(`duration ${f.dur.toFixed(5)}`);
}
// The demuxer ignores the final entry's duration unless the last file is
// repeated, which otherwise drops the closing frame.
lines.push(`file '${name(raw.at(-1))}'`);
const listPath = join(OUT, "frames.txt");
writeFileSync(listPath, lines.join("\n"));

/* ---- 3b. section labels, burned in from the event log -------------------- */

/*
 * These are drawn here rather than in the page. An in-page label was correct
 * by every measurement — present, visible, positioned — yet never reached the
 * screencast. Burning them from the log is deterministic and restyleable
 * without re-recording.
 */
const FONT_SRC = ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"].find((f) => existsSync(f));
if (!FONT_SRC) { console.error("no usable font for drawtext"); process.exit(1); }
const FONT = join(OUT, "label.ttf");
copyFileSync(FONT_SRC, FONT);

/** ffmpeg filter text: backslash, colon, comma, quote and percent all bite. */
const esc = (t) =>
  t
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%");

const labelEvents = events.filter((e) => e.type === "label" || e.type === "label-off");
const drawFilters = [];

for (let i = 0; i < labelEvents.length; i++) {
  const ev = labelEvents[i];
  if (ev.type !== "label") continue;
  // The recorder logs the label and *then* navigates, so the raw event time
  // sits on the previous page. Nudging by the navigation cost in capture time
  // — converted through the same mapping, so fast sections get a small offset
  // and slow ones a larger one — lands the caption on the page it describes.
  const NAV_MS = 1500;
  const from = toOutput(ev.t + NAV_MS);
  const next = labelEvents[i + 1];
  const to = next ? toOutput(next.t + NAV_MS) : TARGET;
  if (to - from < 0.35) continue; // too brief to read

  // Storefront sits at the left edge; the admin has a 240px sidebar to clear.
  const x = ev.dark ? 40 : 280;
  drawFilters.push(
    [
      // Relative path, forward slashes, no drive letter: escaping a Windows
      // absolute path inside a filter string is what broke the first encode.
      `drawtext=fontfile=${FONT.replace(/\\/g, "/")}`,
      `text='${esc(ev.text)}'`,
      `fontsize=30`,
      `fontcolor=white`,
      `x=${x + 18}`,
      `y=h-84`,
      `box=1`,
      `boxcolor=0x0e1118@0.92`,
      `boxborderw=16`,
      `enable='between(t,${from.toFixed(3)},${to.toFixed(3)})'`,
    ].join(":")
  );
}

console.log(`labels       ${drawFilters.length} burned in`);

/* ---- 4. the interface-sound track ---------------------------------------- */

function decode(file) {
  const out = execFileSync(
    FFMPEG,
    ["-v", "error", "-i", file, "-ar", String(SR), "-ac", "2", "-f", "s16le", "-"],
    { maxBuffer: 1 << 28 }
  );
  return new Int16Array(out.buffer, out.byteOffset, out.length / 2);
}

const clickPcm = existsSync(SFX.click) ? decode(SFX.click) : null;
const keyPcm = existsSync(SFX.key) ? decode(SFX.key) : null;
if (!clickPcm || !keyPcm) console.log("  (sfx missing — video will be silent)");

const totalSamples = Math.ceil(TARGET * SR) * 2;
const bed = new Float32Array(totalSamples);

function place(pcm, atSeconds, gain) {
  if (!pcm) return;
  const off = Math.floor(atSeconds * SR) * 2;
  for (let i = 0; i < pcm.length && off + i < totalSamples; i++) {
    bed[off + i] += (pcm[i] / 32768) * gain;
  }
}

let placed = 0;
for (const e of events) {
  if (e.type === "click") { place(clickPcm, toOutput(e.t), 0.5); placed++; }
  else if (e.type === "key") { place(keyPcm, toOutput(e.t), 0.22); placed++; }
}
console.log(`sound        ${placed} interface cues (no music, no narration)`);

// Soft-clip, then write a WAV.
const pcmOut = Buffer.alloc(totalSamples * 2);
for (let i = 0; i < totalSamples; i++) {
  let v = Math.max(-1, Math.min(1, bed[i]));
  pcmOut.writeInt16LE((v * 32767) | 0, i * 2);
}
const wav = Buffer.alloc(44 + pcmOut.length);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + pcmOut.length, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(pcmOut.length, 40);
pcmOut.copy(wav, 44);
const wavPath = join(OUT, "interface.wav");
writeFileSync(wavPath, wav);

/* ---- 5. encode ----------------------------------------------------------- */

const graphPath = join(OUT, "filters.txt");
writeFileSync(graphPath, `[0:v]${drawFilters.join(",")}[v]`);

const outPath = join(OUT, "haze-walkthrough.mp4");
console.log("\nencoding…");
execFileSync(
  FFMPEG,
  [
    "-y", "-v", "warning", "-stats",
    "-f", "concat", "-safe", "0", "-i", listPath,
    "-i", wavPath,
    "-filter_complex", readFileSync(graphPath, "utf8"),
    "-map", "[v]", "-map", "1:a",
    "-fps_mode", "cfr", "-r", String(FPS),
    "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    outPath,
  ],
  { stdio: ["ignore", "inherit", "inherit"] }
);

console.log(`\n-> ${outPath}`);
