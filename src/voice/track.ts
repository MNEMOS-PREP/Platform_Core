/**
 * A line's sound, end to end (v0.29.0, 2026-10-09).
 *
 * The user, after a mock: "I could feel gaps in speech, awkward pauses,
 * sometimes if the text is too long". A line reaches the browser as pieces —
 * sentences, long ones cut at their clauses (`core.ts`) — and each piece was
 * played in its own `<audio>`, started when the one before it ended. Three
 * kinds of silence sat between two pieces, none of them chosen:
 *
 *   - the silence M11's voice leaves at a clip's start and end, which added
 *     up at every cut, mid-sentence included;
 *   - the next `<audio>` starting (a decode and a play, every time);
 *   - a piece not made yet when the one before it ended (a stall).
 *
 * Now the pieces are one track (`player.ts`, Web Audio): each clip trimmed to
 * its sound (`trimBounds`), scheduled to the sample after the one before it,
 * with the pause a person would leave there (`pauseBetween`) — short at a
 * comma, longer at a full stop, a turn's gap when the speaker changes. And a
 * long line whose later pieces would arrive late holds its first word a
 * moment (`holdFor`): a beat before speaking is what a person does; a stall
 * mid-sentence is not.
 *
 * Pure, so it is tested without a browser.
 */

/** Where a clip's sound is, in seconds: its leading and trailing silence cut. */
export interface Bounds {
  start: number;
  end: number;
}

/**
 * The span of a clip worth hearing: from just before its first sound to just
 * after its last. Silence is below `floorDb` of the clip's loudest 10 ms;
 * `keepLead` and `keepTrail` keep a breath of it, so a consonant's onset and
 * a word's decay are never clipped. A clip with no sound is kept whole.
 */
export function trimBounds(
  samples: Float32Array,
  rate: number,
  { floorDb = -42, keepLead = 0.02, keepTrail = 0.06 }: { floorDb?: number; keepLead?: number; keepTrail?: number } = {},
): Bounds {
  const seconds = samples.length / rate;
  const hop = Math.max(1, Math.round(rate / 100));
  const levels: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) sum += samples[j]! * samples[j]!;
    levels.push(Math.sqrt(sum / hop));
  }
  const peak = Math.max(0, ...levels);
  if (peak === 0) return { start: 0, end: seconds };
  const floor = peak * 10 ** (floorDb / 20);
  const first = levels.findIndex((level) => level > floor);
  let last = levels.length - 1;
  while (last > first && levels[last]! <= floor) last--;
  const start = Math.max(0, (first * hop) / rate - keepLead);
  const end = Math.min(seconds, ((last + 1) * hop) / rate + keepTrail);
  return end > start ? { start, end } : { start: 0, end: seconds };
}

/** A persona's tempo, from the manner in its `voice_id` (`en-IN-male-brisk`). */
const TEMPO: Record<string, number> = { brisk: 0.8, measured: 1.2, casual: 1.05, warm: 1, neutral: 1 };

/** A small, repeatable variation, so pauses are never metronomic. */
function jitter(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return 0.85 + ((h >>> 0) % 1000) / 1000 * 0.3; // 0.85 – 1.15
}

/**
 * The silence a person leaves after `before` and before the next words, in
 * seconds: ~0.3 s at a full stop, ~0.1 s at a comma (a clause cut), ~0.22 s
 * when the next words are someone else's (turns follow each other after about
 * 200 ms — Stivers et al. 2009), scaled by the speaker's tempo, plus any
 * pause the line asks for (the note-taking pause, FR-11.12).
 */
export function pauseBetween(
  before: string,
  { sameSpeaker = true, manner, pauseAfterMs = 0 }: { sameSpeaker?: boolean; manner?: string; pauseAfterMs?: number } = {},
): number {
  const text = before.trim();
  const base = !sameSpeaker
    ? 0.22
    : /[.!?]["')\]]*$/.test(text)
      ? 0.3
      : /[,;:—–-]["')\]]*$/.test(text)
        ? 0.1
        : 0.06;
  return base * (TEMPO[manner ?? ""] ?? 1) * jitter(text) + Math.max(0, pauseAfterMs) / 1000;
}

/** A piece of a line still to be heard, as `holdFor` sees it. */
export interface Planned {
  /** How long it will sound, in seconds (estimated before it is made). */
  seconds: number;
  /** The pause after it (`pauseBetween`). */
  pauseAfter: number;
}

/** A pause that long is a person thinking; any longer before a word is not. */
export const MAX_HOLD_S = 1.2;

/**
 * How long to hold a line's first word, once it is ready, so that the rest of
 * the line is made before it is needed (seconds, 0 to `MAX_HOLD_S`).
 *
 * The rest of the line is being made at `rate` seconds of audio per second
 * (several pieces side by side; above 1 is faster than speech), in order. If
 * that would leave a piece unready when its turn comes, the first word waits
 * the shortfall instead — up to `MAX_HOLD_S`; anything beyond becomes a
 * longer pause at a sentence's end, where a person may pause anyway.
 */
export function holdFor(pieces: readonly Planned[], rate: number, maxHold = MAX_HOLD_S): number {
  if (pieces.length < 2 || !(rate > 0)) return 0;
  let made = 0; // audio made after the first piece, seconds
  let heard = pieces[0]!.seconds + pieces[0]!.pauseAfter; // when piece i starts, from the first word
  let hold = 0;
  for (let i = 1; i < pieces.length; i++) {
    made += pieces[i]!.seconds;
    hold = Math.max(hold, made / rate - heard);
    heard += pieces[i]!.seconds + pieces[i]!.pauseAfter;
  }
  return Math.min(maxHold, Math.max(0, hold));
}

/**
 * A running estimate (exponentially weighted): how fast M11 makes speech,
 * and how fast each voice speaks — learned from the pieces a room receives,
 * so `holdFor` predicts from this machine, not from a guess.
 */
export class Rate {
  private value: number;
  private readonly weight: number;
  constructor(initial: number, weight = 0.3) {
    this.value = initial;
    this.weight = weight;
  }
  get(): number {
    return this.value;
  }
  update(sample: number): void {
    if (Number.isFinite(sample) && sample > 0) this.value += (sample - this.value) * this.weight;
  }
}
