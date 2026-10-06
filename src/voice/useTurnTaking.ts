/**
 * A spoken turn, start to finish — M11 days 3–5 in one hook.
 *
 * Listens (`useListening`), decides when the student has finished
 * (`endpoint.ts`: their own pause length, then M11's turn model), and hands
 * the room the whole turn — when it began and ended, how the end was decided,
 * and what was said, in M11's recogniser's words. One transcription per turn,
 * not per breath: the recogniser hears the whole answer at once, which is both
 * more accurate and fewer calls against a free tier's minute.
 *
 * The room still hears every start (`onSpeechStart`) at once — that is when
 * the interviewer must stop (barge-in) — and gets `text: null` when the
 * recogniser could not answer, so it can fall back to the browser's own.
 *
 * Built for M06's room; M14's discussion will take turns the same way.
 *
 * ── Thinking ahead (FR-11.6, v0.25.0) ──────────────────────────────────────
 * At a pause in a turn of three seconds or more, what has been said so far is
 * written down at once and offered to the room (`onPrefill`), so the
 * interviewer can start thinking while the student pauses. If the student
 * says nothing more, those ARE the turn's words — the same audio, written
 * once — so what the room thought about is exactly what the answer says; if
 * they carry on, it is simply not used. Nothing is guessed.
 *
 * ── A caption (FR-11.3, v0.25.0) ───────────────────────────────────────────
 * With `caption`, the turn is captioned from M11's recogniser while it is
 * spoken (`caption.ts`) — for browsers that cannot caption it themselves.
 */
import { useEffect, useRef, useState } from "react";

import { serverAsrAvailable, transcribeOnServer, type AsrResult } from "./asr";
import { useRollingCaption, type Caption } from "./caption";
import {
  adaptiveSilenceMs,
  decide,
  initialEndpoint,
  modelSaid,
  speechEnded,
  speechStarted,
  turnTaken,
  type Decision,
  type EndpointState,
} from "./endpoint";
import { nowMs } from "./ledger";
import { serverTurnReady, turnFinishedOnServer } from "./turn";
import { useListening, type Listening } from "./useListening";

/** One turn the student took. Times are on the ledger's clock. */
export interface SpokenTurn {
  startedAt: number;
  endedAt: number;
  /** M11's words for the whole turn; null when the recogniser could not. */
  text: string | null;
  asr: AsrResult | null;
  /** What called the turn over: the turn model, the silence alone, or the
   *  student switching to typing mid-answer (FR-11.14). */
  how: "model" | "silence" | "switch";
  /** The turn's audio as sent to the recogniser — for keeping, with
   *  consent (FR-11.19). Null when none was kept. */
  audio: Blob | null;
  /** How much silence passed before it was called. */
  silenceMs: number;
}

export interface TurnTakingOptions {
  enabled: boolean;
  /** Whether the interviewer is speaking (the listener's bar rises). */
  playing?: () => boolean;
  /** The question being answered: the recogniser's prompt. */
  context?: () => string | null | undefined;
  /** The student began speaking — the interviewer's cue to stop. */
  onSpeechStart?: (startedAt: number) => void;
  /** The student finished a turn. */
  onTurn: (turn: SpokenTurn) => void;
  /** A pause inside a turn that is not (yet) its end, with how long the
   *  student has been talking — when an interviewer says "mm-hm" (FR-11.11). */
  onPause?: (info: { at: number; talkingMs: number }) => void;
  /** FR-11.6: what has been said so far, at a pause in a turn of 3 s or more
   *  — the room may think ahead with it. If nothing more is said these are
   *  the turn's own words: the same audio, written once. */
  onPrefill?: (prefill: { text: string; asr: AsrResult; startedAt: number; endedAt: number }) => void;
  /** FR-11.3: caption the turn from M11's recogniser while it is spoken —
   *  for a browser that cannot caption it itself. */
  caption?: boolean;
}

export interface TurnTaking extends Listening {
  /** A silence is being weighed: finished, or a pause? */
  deciding: boolean;
  /** A finished turn is being written down. */
  writing: boolean;
  /** The silence that ends this speaker's turn now, in ms (FR-11.4). */
  thresholdMs: number;
  /** End the turn now with what has been said so far — the student switched
   *  to typing mid-answer (FR-11.14). Call BEFORE turning listening off. */
  flush: () => void;
  /** Turns taken too soon this session — the student carried on within
   *  1.5 s (AC-11.3's premature cut-off, v0.24.0). */
  cutShort: () => number;
  /** FR-11.3: the turn so far, from M11's recogniser, when `caption` is on. */
  caption: Caption | null;
}

/** A turn's audio from a moment before its first word to just after its last. */
const BEFORE_MS = 300;
const AFTER_MS = 250;
/** The turn model hears the last 8 s before the silence, and a little of it. */
const MODEL_WINDOW_MS = 8_000;
const MODEL_TAIL_MS = 200;
/** FR-11.6: think ahead only at a pause in a turn this long (≈ eight words),
 *  and not again within this of the last time. */
const PREFILL_AFTER_MS = 3_000;
const PREFILL_GAP_MS = 2_000;

export function useTurnTaking(options: TurnTakingOptions): TurnTaking {
  const latest = useRef(options);
  latest.current = options;
  const state = useRef<EndpointState>(initialEndpoint());
  const timer = useRef<number | null>(null);
  /** Bumped by every new speech: an answer about an older silence is stale. */
  const generation = useRef(0);
  const model = useRef(false);
  const recogniser = useRef(false);
  const [deciding, setDeciding] = useState(false);
  const [writing, setWriting] = useState(0);
  const [thresholdMs, setThresholdMs] = useState(adaptiveSilenceMs([]));
  /** FR-11.6: the turn so far, being written down at a pause. */
  const ahead = useRef<{ startedAt: number; quietSince: number; asr: Promise<AsrResult | null> } | null>(null);
  const lastThought = useRef(0);

  useEffect(() => {
    if (!options.enabled) return;
    void serverTurnReady().then((ready) => (model.current = ready));
    void serverAsrAvailable().then((ready) => (recogniser.current = ready));
  }, [options.enabled]);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const listening = useListening({
    enabled: options.enabled,
    keepAudio: true,
    playing: options.playing,
    // Silence is reported quickly; the endpointer decides what it means.
    config: { releaseMs: 300 },
    onSpeechStart: (startedAt) => {
      generation.current += 1;
      clear();
      setDeciding(false);
      state.current = speechStarted(state.current, startedAt);
      setThresholdMs(adaptiveSilenceMs(state.current.pauses));
      latest.current.onSpeechStart?.(startedAt);
    },
    onSpeechEnd: (endedAt) => {
      state.current = speechEnded(state.current, endedAt);
      const began = state.current.startedAt;
      if (began !== null) {
        latest.current.onPause?.({ at: endedAt, talkingMs: endedAt - began });
        think(began, endedAt);
      }
      step();
    },
  });

  const caption = useRollingCaption({
    enabled: options.enabled && Boolean(options.caption),
    from: () => state.current.startedAt,
    audioBetween: (from, to) => listening.audioBetween(from, to),
    context: () => latest.current.context?.(),
  });

  /** FR-11.6: write down what has been said so far, and offer it to the room —
   *  unless the student carries on, or the turn ends first (it is then the
   *  turn's own words, `finish`). */
  function think(startedAt: number, quietSince: number) {
    const onPrefill = latest.current.onPrefill;
    if (!onPrefill || !recogniser.current || quietSince - startedAt < PREFILL_AFTER_MS) return;
    if (quietSince - lastThought.current < PREFILL_GAP_MS) return;
    // The same cut `finish` will make for these bounds: same audio, same words.
    const audio = listening.audioBetween(startedAt - BEFORE_MS, quietSince + AFTER_MS);
    if (!audio) return;
    lastThought.current = quietSince;
    const asked = generation.current;
    const asr = transcribeOnServer(audio, latest.current.context?.()).catch(() => null);
    ahead.current = { startedAt, quietSince, asr };
    void asr.then((result) => {
      if (!result || asked !== generation.current) return; // they carried on, or it ended
      const text = result.text.trim();
      if (text) latest.current.onPrefill?.({ text, asr: result, startedAt, endedAt: quietSince });
    });
  }

  function act(decision: Decision) {
    if (decision.kind === "wait") {
      setDeciding(true);
      clear();
      timer.current = window.setTimeout(step, Math.max(0, decision.until - nowMs()));
    } else if (decision.kind === "end") {
      finish(decision);
    } else if (decision.kind === "ask") {
      ask(decision.quietSince);
    }
  }

  function step() {
    timer.current = null;
    act(decide(state.current, nowMs(), model.current));
  }

  function ask(quietSince: number) {
    setDeciding(true);
    const asked = generation.current;
    const from = Math.max(state.current.startedAt ?? quietSince, quietSince - MODEL_WINDOW_MS);
    const audio = listening.audioBetween(from, quietSince + MODEL_TAIL_MS);
    if (!audio) {
      model.current = false;
      return step();
    }
    turnFinishedOnServer(audio)
      .then((verdict) => {
        if (asked !== generation.current) return;
        const out = modelSaid(state.current, quietSince, verdict.finished, nowMs());
        state.current = out.state;
        act(out.decision);
      })
      .catch(() => {
        if (asked !== generation.current) return;
        // The model is gone for this room: silence decides from here.
        model.current = false;
        step();
      });
  }

  function finish(end: { startedAt: number; endedAt: number; how: SpokenTurn["how"]; silenceMs: number }) {
    clear();
    setDeciding(false);
    generation.current += 1;
    // A switch is the student's own choice: speech after it is not a sign
    // the turn was taken too soon.
    state.current = turnTaken(
      state.current,
      end.how === "switch" ? null : { endedAt: end.endedAt, takenAt: nowMs() },
    );
    const base = { startedAt: end.startedAt, endedAt: end.endedAt, how: end.how, silenceMs: end.silenceMs };
    const audio = listening.audioBetween(end.startedAt - BEFORE_MS, end.endedAt + AFTER_MS);
    // The pause this turn ended on was already being written down: those
    // words, from the same audio — not a second call for the same answer.
    const thought = ahead.current;
    ahead.current = null;
    const same = thought && thought.startedAt === end.startedAt && thought.quietSince === end.endedAt;
    if (!audio || !recogniser.current) {
      latest.current.onTurn({ ...base, text: null, asr: null, audio });
      return;
    }
    setWriting((n) => n + 1);
    const context = latest.current.context?.();
    const written = same
      ? thought.asr.then((asr) => asr ?? transcribeOnServer(audio, context))
      : transcribeOnServer(audio, context);
    written
      .then((asr) => latest.current.onTurn({ ...base, text: asr.text.trim(), asr, audio }))
      .catch(() => latest.current.onTurn({ ...base, text: null, asr: null, audio }))
      .finally(() => setWriting((n) => Math.max(0, n - 1)));
  }

  /** FR-11.14: the student switches to typing mid-answer — what they said so
   *  far is written down and handed over, not lost with the microphone. */
  function flush() {
    const began = state.current.startedAt;
    if (began === null) return;
    const now = nowMs();
    finish({ startedAt: began, endedAt: state.current.quietSince ?? now, how: "switch", silenceMs: 0 });
  }

  // Turned off (or the room paused): no turn is half-taken.
  useEffect(() => {
    if (options.enabled) return;
    clear();
    generation.current += 1;
    state.current = turnTaken(state.current);
    setDeciding(false);
  }, [options.enabled]);
  useEffect(() => clear, []);

  return {
    ...listening,
    deciding,
    writing: writing > 0,
    thresholdMs,
    flush,
    cutShort: () => state.current.cutShort,
    caption,
  };
}
