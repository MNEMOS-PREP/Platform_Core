/**
 * The microphone check, and echo — M11 day 10 (FR-11.2, EC-11.6, EC-11.8).
 *
 * Pure, so `npm test` pins it; `useListening` and the rooms use it.
 *
 * - **The room's noise floor** (spec §2.3: "measured here and stored — it
 *   calibrates VAD thresholds for the session"): measured during the check,
 *   kept for this browser, and the listener starts from it instead of a
 *   guess. A noisy hostel room gets its raised bar from the first frame.
 * - **A transcription round trip** (FR-11.2): the student reads a sentence;
 *   M11's recogniser writes it down; how much came back says whether the mic
 *   is working well enough to be judged on.
 * - **Echo** (EC-11.8): when what "the student said" is mostly the words the
 *   interviewer was just saying, it is the speakers reaching the mic, not an
 *   answer. It is not sent, and headphones are suggested — once.
 */

/** Where the measured noise floor is kept, for this browser. */
const FLOOR_KEY = "m11.noiseFloorDb";

export type Room = "quiet" | "some noise" | "noisy";

/** A floor, in words a student can act on (EC-11.6 suggests headphones). */
export function roomFrom(floorDb: number): Room {
  if (floorDb < -58) return "quiet";
  if (floorDb < -45) return "some noise";
  return "noisy";
}

export function savedNoiseFloor(): number | null {
  try {
    const raw = localStorage.getItem(FLOOR_KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) && value > -100 && value < 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveNoiseFloor(floorDb: number): void {
  try {
    localStorage.setItem(FLOOR_KEY, String(Math.round(floorDb * 10) / 10));
  } catch {
    /* kept for this visit only */
  }
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The longest run of words two texts share in order, as a share of `of`. */
export function overlap(of: string, against: string): number {
  const a = words(of);
  const b = words(against);
  if (a.length === 0 || b.length === 0) return 0;
  // Longest common subsequence, word by word.
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const wa of a) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      current[j] = wa === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, current[j - 1]!);
    }
    previous = current;
  }
  return previous[b.length]! / a.length;
}

/** FR-11.2: how much of the sentence read aloud came back, 0–1. */
export function heardBack(expected: string, heard: string): number {
  return overlap(expected, heard);
}

/** EC-11.8: what "the student said" is mostly the interviewer's own words —
 *  the speakers reaching the microphone, not an answer. */
export function isEcho(heard: string, interviewerSaid: string): boolean {
  return words(heard).length >= 3 && overlap(heard, interviewerSaid) >= 0.6;
}
