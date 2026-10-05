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

/** One sentence, in the voice M11 casts for this interviewer. */
export async function speakOnServer(
  text: string,
  who: { personaId?: string | null; voiceId?: string | null },
  signal?: AbortSignal,
): Promise<SpokenSentence> {
  const { blob, headers } = await api.postBlob(
    "/v1/voice/speak",
    { text, persona_id: who.personaId ?? null, voice_id: who.voiceId ?? null },
    signal,
  );
  return {
    url: URL.createObjectURL(blob),
    voice: headers.get("X-Voice") ?? "server",
    cached: headers.get("X-Cache") === "hit",
  };
}
