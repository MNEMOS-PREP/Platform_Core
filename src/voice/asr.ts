/**
 * The student's words, heard by M11 (day 4): `POST /v1/voice/transcribe`.
 *
 * The answer's audio goes to M11, which asks a recogniser with word
 * timestamps (Groq's Whisper) and drops the audio; the words come back with
 * where each fell and how sure the recogniser was. Where M11 cannot (no key,
 * no network), the browser's own recognition carries the answer, as it did
 * before — so a room asks once whether this is available, like the voice.
 */
import { api } from "../lib/api";

export interface AsrWord {
  word: string;
  start_ms: number;
  end_ms: number;
  /** 0–1: the recogniser's confidence in the stretch this word is in. */
  confidence: number;
}

/** M11's `ASRResult` (spec §5). Times are from the start of the audio sent. */
export interface AsrResult {
  text: string;
  words: AsrWord[];
  duration_ms: number;
  language: string | null;
  mean_confidence: number;
  /** Stretches the recogniser was unsure of — not to be quoted (FR-11.15). */
  low_confidence_spans: [number, number][];
  speech_start_ms: number | null;
  speech_end_ms: number | null;
  model: string;
  latency_ms: number;
}

const FRESH_MS = 30_000;
let asked: { at: number; state: Promise<boolean> } | null = null;

/** Can M11 transcribe? One request per page per half-minute, whoever asks. */
export function serverAsrAvailable(): Promise<boolean> {
  const now = Date.now();
  if (asked && now - asked.at < FRESH_MS) return asked.state;
  const state = api
    .get<{ available: boolean }>("/v1/voice/asr")
    .then((r) => r.available)
    .catch(() => false);
  asked = { at: now, state };
  return state;
}

/** One stretch of the student speaking, as words with times. `context` is the
 *  question being answered: it biases the recogniser toward its words. */
export function transcribeOnServer(audio: Blob, context?: string | null, signal?: AbortSignal): Promise<AsrResult> {
  const query = context ? `?context=${encodeURIComponent(context.slice(0, 600))}` : "";
  return api.postAudio<AsrResult>(`/v1/voice/transcribe${query}`, audio, signal);
}
