/**
 * Hearing the student start to speak — M11 day 3, spec §6.5 (barge-in).
 *
 * Pure — no React, no audio API — so `npm test` runs it in Node.
 * `useListening.ts` feeds it frames from the microphone.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * The spec's own (§6.5): speech is energy above the noise floor by 12 dB,
 * sustained 250 ms. The sustain is EC-11.14's guard: a cough, a chair or a
 * keyboard is shorter, and a student who starts speaking over the first
 * syllable is still heard, because 250 ms is shorter than any real answer's
 * first word. Brief dips between syllables do not reset it.
 *
 * Three refinements, each for a failure an energy detector is known for:
 *
 * - **The floor moves.** It follows the room down quickly and up slowly, and
 *   only on frames that are not speech, so a student talking does not raise
 *   the bar against themselves. The mic check (day 10) will seed it.
 * - **The bar rises while the interviewer speaks** (`duckDb`). Echo
 *   cancellation removes most of the interviewer's own voice from the mic,
 *   not all of it (Trap 5), and what is left is quieter than a student
 *   talking into a laptop. Headphones remove the question entirely.
 * - **Speech moves.** Syllables rise and fall several times a second; a fan
 *   switching on, a hum or a steady hiss does not. Energy that is loud but
 *   flat over the sustain window is noise — the floor learns it instead.
 *
 * Silero (a learned VAD) is better at telling speech from noise and is the
 * spec's choice for endpointing (day 5, with Smart Turn). For STOPPING the
 * interviewer, the spec's rule is energy, which needs no model download and
 * works on the demo laptop with no network.
 */

export interface VadConfig {
  /** dB above the noise floor that counts as speech (§6.5: 12). */
  marginDb: number;
  /** Speech must hold this long to count (§6.5, EC-11.14: 250 ms). */
  sustainMs: number;
  /** A dip shorter than this between syllables does not reset the sustain. */
  gapMs: number;
  /** Quiet this long ends the speech. */
  releaseMs: number;
  /** While the interviewer speaks the bar rises by this much (Trap 5). */
  duckDb: number;
  /** Loudness must vary at least this much (standard deviation, dB) over the
   *  sustain window to be speech rather than steady noise. */
  minSwingDb: number;
  /** The floor never goes below or above these. */
  minFloorDb: number;
  maxFloorDb: number;
}

export const DEFAULT_VAD: VadConfig = {
  marginDb: 12,
  sustainMs: 250,
  gapMs: 80,
  releaseMs: 700,
  duckDb: 6,
  minSwingDb: 2,
  minFloorDb: -80,
  maxFloorDb: -30,
};

export interface VadState {
  /** The noise floor, dBFS. */
  floorDb: number;
  speaking: boolean;
  /** When the current run above the bar began, or null. */
  aboveSince: number | null;
  /** The last frame above the bar. */
  lastAbove: number | null;
  /** When the current quiet began, while speaking. */
  belowSince: number | null;
  /** The levels of the current run above the bar, for the swing check. */
  run: number[];
}

export type VadEvent =
  /** Speech began at `at` (its first loud frame); decided at `decidedAt`. */
  | { kind: "start"; at: number; decidedAt: number }
  /** Speech ended at `at` (its first quiet frame). */
  | { kind: "end"; at: number }
  | null;

export interface Frame {
  /** The frame's level, dBFS (see `dbOf`). */
  db: number;
  /** When it was heard, ms (the ledger's clock). */
  at: number;
  /** Whether the interviewer is speaking right now. */
  playing: boolean;
}

export function initialVad(floorDb = -60): VadState {
  return { floorDb, speaking: false, aboveSince: null, lastAbove: null, belowSince: null, run: [] };
}

/** A frame's level in dBFS: 0 is full scale, silence is about -90. */
export function dbOf(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return Math.max(-100, 20 * Math.log10(Math.max(rms, 1e-10)));
}

function swing(levels: readonly number[]): number {
  if (levels.length < 2) return 0;
  const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
  return Math.sqrt(levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length);
}

function follow(floor: number, db: number, config: VadConfig): number {
  // Down fast (the room got quieter, or the first frames were loud), up slow.
  const weight = db < floor ? 0.3 : 0.02;
  const next = floor + weight * (db - floor);
  return Math.min(config.maxFloorDb, Math.max(config.minFloorDb, next));
}

/** The bar a frame must clear to be speech. */
export function barOf(state: VadState, playing: boolean, config: VadConfig = DEFAULT_VAD): number {
  return state.floorDb + config.marginDb + (playing ? config.duckDb : 0);
}

/** One frame in, the new state and what (if anything) just happened. */
export function stepVad(
  state: VadState,
  frame: Frame,
  config: VadConfig = DEFAULT_VAD,
): { state: VadState; event: VadEvent } {
  const s: VadState = { ...state, run: state.run };
  const above = frame.db > barOf(s, frame.playing, config);

  if (above) {
    if (s.aboveSince === null || (s.lastAbove !== null && frame.at - s.lastAbove > config.gapMs)) {
      s.aboveSince = frame.at;
      s.run = [];
    }
    s.lastAbove = frame.at;
    s.run = [...s.run, frame.db].slice(-64);
    s.belowSince = null;
    if (!s.speaking && frame.at - s.aboveSince >= config.sustainMs) {
      if (swing(s.run) >= config.minSwingDb) {
        s.speaking = true;
        return { state: s, event: { kind: "start", at: s.aboveSince, decidedAt: frame.at } };
      }
      // Loud and flat: noise the floor has not caught up with (a fan came
      // on). Learn it at once — the bar moves to just above it.
      s.floorDb = Math.min(config.maxFloorDb, Math.max(s.floorDb, frame.db - config.marginDb + 0.5));
      s.aboveSince = null;
      s.run = [];
    }
    return { state: s, event: null };
  }

  // Below the bar.
  if (!s.speaking) {
    s.floorDb = follow(s.floorDb, frame.db, config);
    if (s.lastAbove !== null && frame.at - s.lastAbove > config.gapMs) {
      s.aboveSince = null;
      s.run = [];
    }
    return { state: s, event: null };
  }
  s.belowSince ??= frame.at;
  if (frame.at - s.belowSince >= config.releaseMs) {
    const at = s.belowSince;
    s.speaking = false;
    s.aboveSince = null;
    s.belowSince = null;
    s.run = [];
    return { state: s, event: { kind: "end", at } };
  }
  return { state: s, event: null };
}
