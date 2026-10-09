/**
 * The interviewer's face, moving with their own voice (v0.27.0, 2026-10-08).
 *
 * M11 makes each sentence's lip sync from the sentence's own audio (its
 * `face.py`: 52 ARKit blendshapes at 30 frames a second) and names it in the
 * `X-Face` header the audio comes with. Here: fetching those frames, and
 * reading the one for the audio's current time — the clock that matters is
 * the audio element's, never the page's, so a stall in playback stalls the
 * mouth with it. Chromium's `currentTime` is already what the speakers are
 * sounding (its audio clock counts the output delay), so the only lead
 * needed is the frame's own trip to the screen.
 *
 * Without frames — the browser's own voice, or a sentence whose frames have
 * not arrived yet — the jaw follows the word timing the voice reports
 * (`jawOnly`): less exact, never frozen. Fetching is `server.ts`'s
 * (`faceOnServer`); this file is pure, so it is tested without a browser.
 *
 * v0.28.0: the whole face, every frame (`faceDriver`). The renderer keeps
 * any blendshape it is not sent, so a speaker cut off mid-word kept their
 * mouth open until they spoke again: every frame now names all 52, and a
 * mouth that stops speaking settles shut in about a tenth of a second. The
 * faces blink (the rig's clips move bones only — nothing ever closed an
 * eye), nod into stressed words while they speak, and nod now and then
 * while they listen.
 *
 * v0.29.0: and think. Between the student's answer and the interviewer's
 * first word there is always a pause (the reply being worked out and
 * spoken); a face that holds still through it reads as frozen. A person
 * glances down and aside while they think, and back when they speak.
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

/** The 52 ARKit blendshapes: the renderer's channels, and wav2arkit's. */
export const ARKIT_NAMES = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
  "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft",
  "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight",
  "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
  "jawForward", "jawLeft", "jawOpen", "jawRight",
  "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight",
  "mouthFunnel", "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft",
  "mouthPressRight", "mouthPucker", "mouthRight", "mouthRollLower", "mouthRollUpper",
  "mouthShrugLower", "mouthShrugUpper", "mouthSmileLeft", "mouthSmileRight",
  "mouthStretchLeft", "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight",
  "noseSneerLeft", "noseSneerRight", "tongueOut",
] as const;

/** A face at rest: every blendshape at zero. */
export const REST: Readonly<Expression> = Object.freeze(
  Object.fromEntries(ARKIT_NAMES.map((name) => [name, 0])),
);

/** The expression `seconds` into a sentence, between the two frames either
 *  side (the screen draws twice as often as the frames come). Past its end,
 *  the last frame — a mouth at rest, since a sentence ends in silence. */
export function weightsAt(face: FaceFrames, seconds: number, lookahead = FACE_LOOKAHEAD_S): Expression {
  const out: Expression = {};
  const count = face.frames.length;
  if (count === 0) return out;
  const position = Math.min(count - 1, Math.max(0, (seconds + lookahead) * face.fps));
  const index = Math.floor(position);
  const from = face.frames[index]!;
  const to = face.frames[Math.min(count - 1, index + 1)]!;
  const along = position - index;
  for (let i = 0; i < face.names.length; i++) {
    const a = from[i] ?? 0;
    out[face.names[i]!] = a + ((to[i] ?? 0) - a) * along;
  }
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

/** A face easing to rest over `tau` seconds — every channel by the same
 *  share of what is left, so a mouth closes the way it was open. */
export function settle(face: Expression, dt: number, tau = 0.07): Expression {
  const keep = Math.exp(-Math.max(0, dt) / tau);
  const out: Expression = {};
  for (const name in face) out[name] = (face[name] ?? 0) * keep < 1e-4 ? 0 : (face[name] ?? 0) * keep;
  return out;
}

/** A number from a string, for seeding: FNV-1a. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A seeded random stream in [0, 1): mulberry32. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One blink, `ms` after it began: the lids close in 80 ms and open in 180
 *  (they fall faster than they lift); 0 outside it. */
export function blinkShape(ms: number): number {
  if (ms < 0 || ms > BLINK_MS) return 0;
  const smooth = (x: number) => x * x * (3 - 2 * x);
  return 0.95 * (ms < 80 ? smooth(ms / 80) : 1 - smooth((ms - 80) / 180));
}
const BLINK_MS = 260;

/**
 * When a face blinks, as a function of seconds since it appeared: every 2 to
 * 5.5 seconds (about sixteen a minute, as people blink in conversation), one
 * time in eight twice in a row. Seeded by the persona, so the faces at one
 * table never blink together, and the same face blinks the same way twice.
 */
export function blinker(seed: string): (seconds: number) => number {
  const random = stream(hash(`blink:${seed}`));
  const starts: number[] = [];
  let next = 0.8 + random() * 2.5;
  return (seconds) => {
    while (next <= seconds) {
      starts.push(next);
      if (random() < 0.125) {
        next += 0.32;
        starts.push(next);
      }
      next += 2 + random() * 3.5;
    }
    let lids = 0;
    for (let i = starts.length - 1; i >= 0; i--) {
      const ms = (seconds - starts[i]!) * 1000;
      if (ms > BLINK_MS) break;
      lids = Math.max(lids, blinkShape(ms));
    }
    return lids;
  };
}

/** Small turns of the rig's `head` bone on top of its idle clip, in radians
 *  (the renderer's YXZ order): x nods the chin down, y turns, z tilts. */
export interface HeadPose {
  head: [number, number, number];
}

const DEGREE = Math.PI / 180;

/**
 * The head's own motion. While speaking (`speaking`, 0-1, eased in and out
 * so the head never snaps): a slow sway, and a nod into each stressed word —
 * the mouth opening wider than it has lately (`open` against `usual`, the
 * jaw's last ~0.4 s) is the stress. While listening (`listening`, 0-1): a
 * slight attentive tilt, and a nod every five and a half seconds. Every
 * turn stays within a few degrees, as a seated person's does. Null when the
 * idle clip should move the head alone.
 */
export function headPose(
  seconds: number,
  open: number,
  usual: number,
  speaking: number,
  listening: number,
  phase: number,
  thinking = 0,
): HeadPose | null {
  if (speaking < 0.001 && listening < 0.001 && thinking < 0.001) return null;
  const wave = (hz: number, shift: number) => Math.sin(2 * Math.PI * hz * seconds + phase + shift);
  const stress = Math.min(1, Math.max(0, open - usual) * 6);
  const cycle = ((seconds + phase) % 5.5) / 5.5;
  const nod = cycle < 0.13 ? Math.sin((Math.PI * cycle) / 0.13) : 0;
  // Thinking: the chin a little down and the head a little aside, drifting.
  const drift = 0.4 * wave(0.11, 2.3);
  // Never past 5 degrees, however the motions overlap (thinking easing out
  // as speaking eases in): a seated person's head moves that little.
  const limit = (deg: number) => DEGREE * Math.max(-5, Math.min(5, deg));
  return {
    head: [
      limit(speaking * (1.0 * wave(0.21, 0) + 2.2 * stress) + listening * 2.0 * nod + thinking * (2.2 + drift)),
      limit(speaking * 1.6 * wave(0.13, 1.7) + thinking * (2.8 + drift)),
      limit(speaking * 0.8 * wave(0.17, 0.6) + listening * 1.5 + thinking * 0.8),
    ],
  };
}

/** Eases `value` toward `target` over `tau` seconds. */
function toward(value: number, target: number, dt: number, tau: number): number {
  return value + (target - value) * (1 - Math.exp(-dt / tau));
}

/**
 * One head's face, frame by frame — what `TalkingHead` hands the renderer.
 * `frame` is called once a frame with the page's clock (seconds), the
 * speech expression when this person is heard (`voice.expression`), and
 * whether they are listening to the student; it returns all 52 channels.
 * `pose` is the head motion for the frame just made.
 */
export function faceDriver(seed: string) {
  const blink = blinker(seed);
  const phase = (hash(`head:${seed}`) / 4294967296) * 2 * Math.PI;
  let began: number | null = null;
  let last = 0;
  let face: Expression = { ...REST };
  let usual = 0;
  let speaking = 0;
  let listening = 0;
  let thinking = 0;
  let pose: HeadPose | null = null;
  return {
    frame(now: number, speech: Expression | null, isListening: boolean, isThinking = false): Expression {
      began ??= now;
      const seconds = now - began;
      const dt = Math.min(0.25, Math.max(0, seconds - last));
      last = seconds;
      // Speech exactly as the frames say (no easing: the lip sync is the
      // audio's); silence eased shut from wherever the mouth was.
      face = speech ? { ...REST, ...speech } : { ...REST, ...settle(face, dt) };
      const open = face.jawOpen ?? 0;
      usual = toward(usual, open, dt, 0.4);
      speaking = toward(speaking, speech ? 1 : 0, dt, speech ? 0.35 : 0.6);
      listening = toward(listening, isListening && !speech ? 1 : 0, dt, 0.5);
      thinking = toward(thinking, isThinking && !speech ? 1 : 0, dt, isThinking && !speech ? 0.6 : 0.3);
      pose = headPose(seconds, open, usual, speaking, listening, phase, thinking);
      const lids = blink(seconds);
      // The eyes go with the head while thinking: down, and to one side.
      const look = thinking * 0.22;
      return {
        ...face,
        eyeBlinkLeft: Math.max(face.eyeBlinkLeft ?? 0, lids),
        eyeBlinkRight: Math.max(face.eyeBlinkRight ?? 0, lids),
        eyeLookDownLeft: Math.max(face.eyeLookDownLeft ?? 0, look),
        eyeLookDownRight: Math.max(face.eyeLookDownRight ?? 0, look),
        eyeLookOutLeft: Math.max(face.eyeLookOutLeft ?? 0, look * 0.6),
        eyeLookInRight: Math.max(face.eyeLookInRight ?? 0, look * 0.6),
      };
    },
    pose: (): HeadPose | null => pose,
  };
}
