/**
 * The sound "claim my seat" makes.
 *
 * Synthesised rather than played from a file. A two-note bell is a few hundred
 * bytes of oscillator configuration; as an asset it would be a 20–40 KB MP3,
 * a network request, a decode, and a format matrix to test. It also means the
 * sound is tunable in one place instead of requiring someone to re-export audio.
 *
 * Deliberately quiet and short — a rising fifth, about a third of a second,
 * with a lowpass taking the glassy edge off. It should read as the seal being
 * pressed, not as a notification.
 *
 * Nothing here runs unless someone clicks the button. Browsers refuse to start
 * an AudioContext outside a user gesture anyway, which is why the context is
 * created lazily on the first click rather than at module load.
 */

type Ctor = typeof AudioContext;

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (context) return context;
  if (typeof window === "undefined") return null;

  const Ctx: Ctor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!Ctx) return null;

  try {
    context = new Ctx();
  } catch {
    // Some locked-down browsers refuse outright. Silence is an acceptable
    // outcome for a decorative sound.
    return null;
  }
  return context;
}

/** A5 then E6 — a rising fifth, which resolves rather than asks. */
const NOTES: { hz: number; at: number; gain: number }[] = [
  { hz: 880, at: 0, gain: 0.16 },
  { hz: 1318.51, at: 0.085, gain: 0.12 },
];

const DECAY = 0.42;

export function playClaimChime(): void {
  const ctx = getContext();
  if (!ctx) return;

  // A context created before the page had a gesture starts suspended, and a
  // tab returning from the background can suspend an existing one.
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);

  const now = ctx.currentTime;

  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3600;

  const out = ctx.createGain();
  out.gain.value = 0.9;

  tone.connect(out);
  out.connect(ctx.destination);

  for (const note of NOTES) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = note.hz;

    const env = ctx.createGain();
    const start = now + note.at;
    // A 6 ms attack instead of an instant one: a square-edged start is heard
    // as a click before it is heard as a note.
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(note.gain, start + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, start + DECAY);

    osc.connect(env);
    env.connect(tone);
    osc.start(start);
    osc.stop(start + DECAY + 0.02);
    // Nodes are single-use; let them go as soon as they have sounded.
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }
}
