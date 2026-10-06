/**
 * A student's spoken answers, kept — M11 day 12 (FR-11.19), only with consent.
 *
 * The room sends each spoken turn's audio (the same WAV the recogniser
 * heard) to M11 with the turn it answered and when it was said, so the notes
 * can play it back beside the words. Nothing is sent unless the student
 * turned keeping on; M11 refuses an upload that does not say so, and the
 * student can delete every kept answer of an interview at once.
 */
import { api } from "../lib/api";

export interface KeptAnswer {
  turn_id: string;
  duration_ms: number;
  started_at: number | null;
  ended_at: number | null;
}

/** Where a student's choice to keep answers is remembered, for this browser. */
const KEEP_KEY = "m11.keepAnswers";

export function keepingAnswers(): boolean {
  try {
    return localStorage.getItem(KEEP_KEY) === "on";
  } catch {
    return false;
  }
}

export function setKeepingAnswers(on: boolean): void {
  try {
    localStorage.setItem(KEEP_KEY, on ? "on" : "off");
  } catch {
    /* for this visit only */
  }
}

export function keepAnswerAudio(
  sessionId: string,
  turnId: string,
  audio: Blob,
  when: { startedAt?: number | null; endedAt?: number | null } = {},
): Promise<KeptAnswer> {
  const query = new URLSearchParams({ turn_id: turnId, consent: "yes" });
  if (when.startedAt) query.set("started_at", String(Math.round(when.startedAt)));
  if (when.endedAt) query.set("ended_at", String(Math.round(when.endedAt)));
  return api.postAudio<KeptAnswer>(`/v1/voice/${encodeURIComponent(sessionId)}/audio?${query}`, audio);
}

export function keptAnswers(sessionId: string): Promise<KeptAnswer[]> {
  return api.get<KeptAnswer[]>(`/v1/voice/${encodeURIComponent(sessionId)}/audio`);
}

/** One kept answer as a playable URL (revoke it when done). */
export async function keptAnswerUrl(sessionId: string, turnId: string): Promise<string> {
  const blob = await api.getBlob(
    `/v1/voice/${encodeURIComponent(sessionId)}/audio/${encodeURIComponent(turnId)}`,
  );
  return URL.createObjectURL(blob);
}

export function forgetKeptAnswers(sessionId: string): Promise<void> {
  return api.del<void>(`/v1/voice/${encodeURIComponent(sessionId)}/audio`);
}
