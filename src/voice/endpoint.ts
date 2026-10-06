/**
 * When has the student finished? — M11 day 5 (spec §6.2, §6.3; FR-11.4/11.5).
 *
 * Pure — no React, no timers, no network — so `npm test` pins every rule.
 * `useTurnTaking.ts` drives it with the listener's events and a clock.
 *
 * A silence ends a turn when two things are true:
 *
 * 1. **It has lasted long enough for THIS speaker** (§6.2, FR-11.4). Someone
 *    whose mid-answer pauses run 500 ms must not be cut off at 550. The wait
 *    is `550 + 1.2 × (mean of their own pauses − 250)`, kept within
 *    400–1,400 ms. A pause they resumed from is how their pauses are learned,
 *    across the session — "this one adaptation removes most 'it cut me off'
 *    complaints on its own."
 * 2. **It sounds finished** (§6.3, FR-11.5). At that moment M11's turn model
 *    (Smart Turn) hears the last seconds; a "not yet" waits 600 ms more and
 *    asks again — never more than 2.5 s of silence in all. Where the model
 *    cannot answer, the silence alone decides.
 *
 * Two rules from a live panel run (v0.24.0, 2026-10-06), where a student
 * explaining in three sentences was answered after the first: a ~700 ms
 * pause after a complete sentence, which the turn model heard — rightly — as
 * a sentence that had ended, though the answer had not.
 *
 * 3. **A long answer gets room.** Once an answer has run 4 s, a pause must
 *    reach 1 s before the model is asked. A pause between two sentences of
 *    an explanation is not the end of it; a short "O(n)." is still answered
 *    at the spec's quick 550.
 * 4. **A turn taken too soon is learned from.** Speech within 1.5 s of a
 *    turn being taken means the student was not finished. The silence it was
 *    taken on was one of their pauses: it is learned, so the next is waited
 *    out, and counted (`cutShort`) — AC-11.3's premature cut-off, measured.
 */

export interface EndpointConfig {
  baseMs: number;
  slope: number;
  pivotMs: number;
  minMs: number;
  maxMs: number;
  /** "Not finished" waits this much longer before asking again. */
  extendMs: number;
  /** Silence never runs longer than this before the turn ends regardless. */
  capMs: number;
  /** A gap shorter than this is not a pause — it is between syllables. */
  minPauseMs: number;
  /** How many of the speaker's recent pauses count. */
  window: number;
  /** An answer that has run this long… */
  longAfterMs: number;
  /** …waits at least this much quiet before the turn model is asked. */
  longMinMs: number;
  /** Speech this soon after a turn was taken means it was taken too soon. */
  rejoinMs: number;
}

export const DEFAULT_ENDPOINT: EndpointConfig = {
  baseMs: 550,
  slope: 1.2,
  pivotMs: 250,
  minMs: 400,
  maxMs: 1400,
  extendMs: 600,
  capMs: 2500,
  minPauseMs: 150,
  window: 12,
  longAfterMs: 4000,
  longMinMs: 1000,
  rejoinMs: 1500,
};

/** §6.2: the silence that ends a turn, for a speaker with these pauses. */
export function adaptiveSilenceMs(pauses: readonly number[], config: EndpointConfig = DEFAULT_ENDPOINT): number {
  const recent = pauses.slice(-config.window);
  if (recent.length === 0) return config.baseMs;
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const wait = config.baseMs + config.slope * (mean - config.pivotMs);
  return Math.round(Math.max(config.minMs, Math.min(config.maxMs, wait)));
}

export interface EndpointState {
  /** When the current turn's first speech began, or null between turns. */
  startedAt: number | null;
  /** When the current silence began, or null while speaking. */
  quietSince: number | null;
  /** When to decide next, or null. */
  decideAt: number | null;
  /** The speaker's pauses, learned across turns. */
  pauses: number[];
  /** "Not finished" answers in this silence. */
  extensions: number;
  /** The last turn taken: when its speech ended and when it was taken. */
  lastTaken: { endedAt: number; takenAt: number } | null;
  /** Turns taken too soon this session — the student carried on. */
  cutShort: number;
}

export type Decision =
  | { kind: "wait"; until: number }
  /** Ask the turn model about the speech up to `quietSince`. */
  | { kind: "ask"; quietSince: number }
  /** The turn is over. `how` says what decided it. */
  | { kind: "end"; startedAt: number; endedAt: number; how: "model" | "silence"; silenceMs: number }
  | { kind: "none" };

export function initialEndpoint(pauses: number[] = []): EndpointState {
  return { startedAt: null, quietSince: null, decideAt: null, pauses, extensions: 0, lastTaken: null, cutShort: 0 };
}

/** The student began speaking: a new turn, or the same one after a pause. */
export function speechStarted(state: EndpointState, at: number, config: EndpointConfig = DEFAULT_ENDPOINT): EndpointState {
  const s = { ...state, pauses: [...state.pauses] };
  if (s.startedAt === null) {
    s.startedAt = at;
    const last = s.lastTaken;
    if (last && at - last.takenAt <= config.rejoinMs) {
      // They were not finished: the turn was taken too soon. The silence it
      // was taken on — to where they carried on — was one of their pauses.
      s.pauses = [...s.pauses, Math.min(at - last.endedAt, config.maxMs)].slice(-config.window * 4);
      s.cutShort += 1;
    }
    s.lastTaken = null;
  } else if (s.quietSince !== null) {
    const pause = at - s.quietSince;
    // A pause they came back from: learned, unless it was a breath or a cap.
    if (pause >= config.minPauseMs && pause < config.capMs) s.pauses = [...s.pauses, pause].slice(-config.window * 4);
  }
  s.quietSince = null;
  s.decideAt = null;
  s.extensions = 0;
  return s;
}

/** The student fell silent at `at` (the first quiet frame). */
export function speechEnded(state: EndpointState, at: number, config: EndpointConfig = DEFAULT_ENDPOINT): EndpointState {
  if (state.startedAt === null) return state;
  let wait = adaptiveSilenceMs(state.pauses, config);
  // Rule 3: a long answer's pause between sentences is waited out.
  if (at - state.startedAt >= config.longAfterMs) wait = Math.max(wait, config.longMinMs);
  return { ...state, quietSince: at, decideAt: at + wait, extensions: 0 };
}

/** What to do now. `model` says whether a turn model can be asked. */
export function decide(state: EndpointState, now: number, model: boolean, config: EndpointConfig = DEFAULT_ENDPOINT): Decision {
  if (state.startedAt === null || state.quietSince === null || state.decideAt === null) return { kind: "none" };
  const silence = now - state.quietSince;
  if (silence >= config.capMs || (!model && now >= state.decideAt)) {
    return { kind: "end", startedAt: state.startedAt, endedAt: state.quietSince, how: "silence", silenceMs: silence };
  }
  if (now < state.decideAt) return { kind: "wait", until: state.decideAt };
  return { kind: "ask", quietSince: state.quietSince };
}

/** The turn model answered for the silence that began at `quietSince`. */
export function modelSaid(
  state: EndpointState,
  quietSince: number,
  finished: boolean,
  now: number,
  config: EndpointConfig = DEFAULT_ENDPOINT,
): { state: EndpointState; decision: Decision } {
  // An answer about a silence that has since been broken is about nothing.
  if (state.quietSince !== quietSince || state.startedAt === null) return { state, decision: { kind: "none" } };
  if (finished) {
    return {
      state,
      decision: { kind: "end", startedAt: state.startedAt, endedAt: quietSince, how: "model", silenceMs: now - quietSince },
    };
  }
  const until = Math.min(now + config.extendMs, quietSince + config.capMs);
  return { state: { ...state, decideAt: until, extensions: state.extensions + 1 }, decision: { kind: "wait", until } };
}

/** After a turn ends: ready for the next, keeping what was learned. With
 *  when its speech ended and when it was taken, speech soon after is known
 *  for a continuation (rule 4); without, nothing is assumed. */
export function turnTaken(
  state: EndpointState,
  taken: { endedAt: number; takenAt: number } | null = null,
): EndpointState {
  return { ...initialEndpoint(state.pauses), lastTaken: taken, cutShort: state.cutShort };
}
