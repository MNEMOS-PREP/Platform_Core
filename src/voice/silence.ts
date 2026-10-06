/**
 * How long the interviewer waits before answering — M11 day 11 (FR-11.10).
 *
 * Spec §2.2, measured from recordings: an interviewer starts 300–900 ms after
 * the candidate finishes, and sometimes holds 2–5 s of deliberate silence —
 * thinking, note-taking, or pressure. "A 200 ms response is uncanny; 800 ms
 * is natural; 2,500 ms is broken" — unless it is meant. The UI does not
 * change during it (§8: "Deliberate silence — nothing changes").
 *
 * Pure: the room asks for a gap and the voice waits until the end of the
 * student's speech plus that gap before its first sound — never sooner. Our
 * pipeline is usually slower than the gap already (recognition, the
 * interviewer's step, the voice), so the gap only shows when a line is fast
 * — a cached one — or when it is deliberate.
 *
 * Calibrated per persona and mode, from the persona file's own numbers:
 * patient interviewers leave a little more room; Final Boss sometimes holds a
 * silence long enough to be felt (pressure by mechanics, FR-6.9, never by
 * rudeness). Deterministic per line, so a replay waits the same.
 */

export interface SilenceInput {
  /** The persona's patience, 0–1. */
  patience: number;
  /** The mode: "practice", "mock", "real_drive", "final_boss". */
  mode: string;
  /** The line's key — the seed, so the same line always waits the same. */
  key: string;
  /** The line asks a new question rather than following up. */
  newQuestion?: boolean;
}

function unit(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** The natural gap, 300–900 ms: patience moves it within the range. */
export function naturalGapMs(patience: number, key: string): number {
  const p = Math.max(0, Math.min(1, patience));
  const centre = 380 + 420 * p; // 380 ms impatient … 800 ms patient
  return Math.round(Math.max(300, Math.min(900, centre + (unit(key, 1) - 0.5) * 160)));
}

/** Final Boss, now and then, before a new question: a held silence. */
export function deliberateMs(input: SilenceInput): number {
  if (input.mode !== "final_boss" || !input.newQuestion) return 0;
  if (unit(input.key, 2) >= 0.34) return 0; // about one new question in three
  return Math.round(1800 + unit(input.key, 3) * 1700); // 1.8–3.5 s
}

/** The whole wait between the end of the student's speech and the voice. */
export function silenceBeforeMs(input: SilenceInput): number {
  return naturalGapMs(input.patience, input.key) + deliberateMs(input);
}
