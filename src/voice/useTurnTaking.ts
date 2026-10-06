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
 */
import { useEffect, useRef, useState } from "react";

import { serverAsrAvailable, transcribeOnServer, type AsrResult } from "./asr";
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
  /** What called the turn over: the turn model, or the silence alone. */
  how: "model" | "silence";
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
}

export interface TurnTaking extends Listening {
  /** A silence is being weighed: finished, or a pause? */
  deciding: boolean;
  /** A finished turn is being written down. */
  writing: boolean;
  /** The silence that ends this speaker's turn now, in ms (FR-11.4). */
  thresholdMs: number;
}

/** A turn's audio from a moment before its first word to just after its last. */
const BEFORE_MS = 300;
const AFTER_MS = 250;
/** The turn model hears the last 8 s before the silence, and a little of it. */
const MODEL_WINDOW_MS = 8_000;
const MODEL_TAIL_MS = 200;

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
      step();
    },
  });

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

  function finish(end: Extract<Decision, { kind: "end" }>) {
    clear();
    setDeciding(false);
    state.current = turnTaken(state.current);
    const base = { startedAt: end.startedAt, endedAt: end.endedAt, how: end.how, silenceMs: end.silenceMs };
    const audio = recogniser.current ? listening.audioBetween(end.startedAt - BEFORE_MS, end.endedAt + AFTER_MS) : null;
    if (!audio) {
      latest.current.onTurn({ ...base, text: null, asr: null });
      return;
    }
    setWriting((n) => n + 1);
    transcribeOnServer(audio, latest.current.context?.())
      .then((asr) => latest.current.onTurn({ ...base, text: asr.text.trim(), asr }))
      .catch(() => latest.current.onTurn({ ...base, text: null, asr: null }))
      .finally(() => setWriting((n) => Math.max(0, n - 1)));
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

  return { ...listening, deciding, writing: writing > 0, thresholdMs };
}
