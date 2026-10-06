/**
 * "Does that sound finished?" — M11's turn model (day 5, Smart Turn v3.2),
 * asked with the last seconds of the student's speech before a silence.
 * Where it cannot answer, `useTurnTaking` ends a turn on silence alone.
 */
import { api } from "../lib/api";

export interface TurnVerdict {
  /** The probability the speech before the silence is a finished turn. */
  probability: number;
  finished: boolean;
  latency_ms: number;
}

const FRESH_MS = 30_000;
let asked: { at: number; state: Promise<boolean> } | null = null;

/** Is M11's turn model ready? One request per page per half-minute. */
export function serverTurnReady(): Promise<boolean> {
  const now = Date.now();
  if (asked && now - asked.at < FRESH_MS) return asked.state;
  const state = api
    .get<{ state: string }>("/v1/voice/turn")
    .then((r) => r.state === "ready")
    .catch(() => false);
  asked = { at: now, state };
  return state;
}

/** The last seconds of speech up to a silence (a 16 kHz WAV). */
export function turnFinishedOnServer(audio: Blob, signal?: AbortSignal): Promise<TurnVerdict> {
  return api.postAudio<TurnVerdict>("/v1/voice/turn", audio, signal);
}
