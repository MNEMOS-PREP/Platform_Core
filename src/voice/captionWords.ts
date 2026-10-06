/**
 * The pure half of live captions (`caption.ts`, FR-11.3): the recogniser's
 * words as a caption, unsure ones marked. No imports at run time, so
 * `npm test` pins it.
 */
import type { AsrResult } from "./asr";

export interface CaptionWord {
  word: string;
  /** The recogniser was unsure of it: shown lighter, never quoted. */
  unsure: boolean;
}

export interface Caption {
  words: CaptionWord[];
  /** The turn began before the window: earlier words are not shown. */
  truncated: boolean;
}

export const CAPTION_EVERY_MS = 2500;
export const CAPTION_WINDOW_MS = 10_000;
/** M11's own line for a word nobody should quote (asr.py, LOW_CONFIDENCE). */
export const UNSURE_BELOW = 0.45;

/** The recogniser's words as a caption. */
export function captionFrom(result: AsrResult, truncated: boolean): Caption {
  return {
    words: result.words.map((w) => ({ word: w.word, unsure: w.confidence < UNSURE_BELOW })),
    truncated,
  };
}
