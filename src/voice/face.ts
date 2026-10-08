/**
 * The interviewer's face, moving with their own voice (v0.27.0, 2026-10-08).
 *
 * M11 makes each sentence's lip sync from the sentence's own audio (its
 * `face.py`: 52 ARKit blendshapes at 30 frames a second) and names it in the
 * `X-Face` header the audio comes with. Here: fetching those frames, and
 * reading the one for the audio's current time — the clock that matters is
 * the audio element's, never the page's, so a stall in playback stalls the
 * mouth with it.
 *
 * Without frames — the browser's own voice, or a sentence whose frames have
 * not arrived yet — the jaw follows the word timing the voice reports
 * (`jawOnly`): less exact, never frozen. Fetching is `server.ts`'s
 * (`faceOnServer`); this file is pure, so it is tested without a browser.
 */
export interface FaceFrames {
  fps: number;
  /** The 52 ARKit blendshape names, in the order of each frame's values. */
  names: string[];
  frames: number[][];
}

export type Expression = Record<string, number>;

/** Each frame is drawn about a frame after it is chosen: look that far ahead. */
export const FACE_LOOKAHEAD_S = 1 / 30;

/** The expression `seconds` into a sentence. Past its end, the last frame —
 *  a mouth at rest, since a sentence ends in silence. */
export function weightsAt(face: FaceFrames, seconds: number, lookahead = FACE_LOOKAHEAD_S): Expression {
  const out: Expression = {};
  if (face.frames.length === 0) return out;
  const index = Math.min(face.frames.length - 1, Math.max(0, Math.floor((seconds + lookahead) * face.fps)));
  const frame = face.frames[index]!;
  for (let i = 0; i < face.names.length; i++) out[face.names[i]!] = frame[i] ?? 0;
  return out;
}

/** A jaw from how open the mouth is (0-1), for a voice with no frames. */
export function jawOnly(openness: number): Expression {
  const o = Math.max(0, Math.min(1, openness));
  return {
    jawOpen: 0.42 * o,
    mouthLowerDownLeft: 0.3 * o,
    mouthLowerDownRight: 0.3 * o,
    mouthUpperUpLeft: 0.12 * o,
    mouthUpperUpRight: 0.12 * o,
  };
}
