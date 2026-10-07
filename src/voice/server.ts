/**
 * The server voice — M11's Chatterbox voices (v0.16.0).
 *
 * After a blind listening test the team chose Chatterbox Turbo voices, mostly
 * Indian, made by M11 (`POST /v1/voice/speak`). This file is the browser's
 * half: is that voice ready, and the audio for one sentence in the voice cast
 * for an interviewer. The hook (`useInterviewerVoice`) decides when to use it.
 *
 * A room asks ONCE whether the server voice is ready and keeps the answer for
 * the whole interview: a voice that changed mid-conversation would sound like
 * a second person joining. Asked again by the next room, so a server that
 * finishes warming up is used from the next interview on.
 */

import { api } from "../lib/api";

export type ServerVoiceState = "off" | "loading" | "ready" | "failed" | "unreachable";

/** How long one page trusts an answer before asking again. */
const FRESH_MS = 30_000;
let asked: { at: number; state: Promise<ServerVoiceState> } | null = null;

/** Is M11's voice ready? One request per page per half-minute, whoever asks. */
export function serverVoiceState(): Promise<ServerVoiceState> {
  const now = Date.now();
  if (asked && now - asked.at < FRESH_MS) return asked.state;
  const state = api
    .get<{ state: ServerVoiceState }>("/v1/voice/engine")
    .then((r) => r.state)
    .catch(() => "unreachable" as const);
  asked = { at: now, state };
  return state;
}

/** Forget the cached answer — after a sentence failed, say. */
export function forgetServerVoiceState(): void {
  asked = null;
}

export interface SpokenSentence {
  /** An object URL for the audio; revoke it when played. */
  url: string;
  /** M11's key for the voice that spoke (`indictts-123823`). */
  voice: string;
  /** Made before (M11's cache), so it came back instantly. */
  cached: boolean;
}

/** One sentence, in the voice M11 casts for this interviewer. `line` is the
 *  room's id for the line it belongs to, as given to `planOnServer`. */
export async function speakOnServer(
  text: string,
  who: { personaId?: string | null; voiceId?: string | null },
  signal?: AbortSignal,
  line?: string | null,
): Promise<SpokenSentence> {
  const { blob, headers } = await api.postBlob(
    "/v1/voice/speak",
    { text, persona_id: who.personaId ?? null, voice_id: who.voiceId ?? null, line: line ?? null },
    signal,
  );
  return {
    url: URL.createObjectURL(blob),
    voice: headers.get("X-Voice") ?? "server",
    cached: headers.get("X-Cache") === "hit",
  };
}

/** A sentence of a line to plan: its words and who says them. */
export interface PlannedSentence {
  text: string;
  personaId?: string | null;
  voiceId?: string | null;
}

/**
 * Start M11 making a whole line now, its sentences side by side (v0.26.0):
 * on a CPU three are made at once barely slower than one, so by the time the
 * room asks for each sentence in order, most are made — the gap that followed
 * every full stop, while the next sentence was made, is gone. Best-effort:
 * if it fails, each sentence is made when asked for, as before.
 */
export function planOnServer(line: string, sentences: readonly PlannedSentence[]): void {
  if (sentences.length === 0) return;
  void api
    .post("/v1/voice/plan", {
      line,
      sentences: sentences.slice(0, 24).map((s) => ({
        text: s.text,
        persona_id: s.personaId ?? null,
        voice_id: s.voiceId ?? null,
      })),
    })
    .catch(() => undefined);
}

/** The room stopped these lines (a barge-in, a repeat, the student's own
 *  answer): M11 skips their sentences it has not started. */
export function dropOnServer(lines: readonly string[]): void {
  if (lines.length === 0) return;
  void api.post("/v1/voice/drop", { lines: lines.slice(0, 32) }).catch(() => undefined);
}
