/**
 * The latency ledger, browser half (M11 spec §5 `TurnTiming`, §11; v0.15.0).
 *
 * Every line the interviewer speaks is one record: when it reached the room,
 * when its first audio played, when it finished — or when something asked it
 * to stop, why, and how much of it the student had heard by then. The room
 * adds the two marks only it knows: when the student's answer was sent and
 * when the interviewer's first token streamed back.
 *
 * The hook records; M11 keeps (`POST /v1/voice/{session_id}/timings`) and
 * turns the marks into the spec's stages on read. Nothing here decides a
 * number is good or bad — the server holds the targets, in one place.
 *
 * Times are epoch milliseconds from the page's monotonic clock
 * (`performance.timeOrigin + performance.now()`), so a line's stages are
 * exact relative to each other and comparable across lines.
 *
 * Pure — no React, no network — so `npm test` runs it in Node; the hook in
 * `useInterviewerVoice.ts` posts the records.
 */

/** Why a line stopped before it finished. */
export type StopReason =
  | "barge_in" // the student started speaking (VAD, day 3)
  | "mic" // the student opened the mic
  | "send" // the student sent their answer
  | "pause" // the session was paused
  | "end" // the session ended
  | "repeat" // the student asked for it again, which interrupts
  | "off" // the student turned the voice off
  | "leave"; // the room closed mid-line

/** One spoken line, as the browser saw it — what M11 stores. */
export interface LineTiming {
  /** Made here; the server's idempotency key, so a retried post is one row. */
  id: string;
  /** The room's name for the line: a turn id, "idle", "repeat". */
  key: string;
  /** Which voice spoke it: the browser's own, or M11's (v0.16.0). */
  tier: "browser" | "server";
  voice_name: string | null;
  rate: number;
  /** Characters in the line as spoken (`speakable`), and how many were heard. */
  line_chars: number;
  heard_chars: number | null;
  answer_sent_at: number | null;
  first_token_at: number | null;
  landed_at: number;
  first_audio_at: number | null;
  ended_at: number | null;
  stop_requested_at: number | null;
  stopped_at: number | null;
  stop_reason: StopReason | null;
  /** Barge-in (v0.18.0): when the student began speaking over the line — the
   *  first loud frame, before the 250 ms that made it count (spec §6.5). */
  speech_started_at: number | null;
  /** The interviewer finished up to 1.5 s before yielding, on purpose (Final
   *  Boss, spec §6.5) — so the stop is not measured against the budget. */
  contested: boolean;
  /** The browser refused to speak before a click (autoplay policy). */
  blocked: boolean;
  /** Any other synthesis error the browser reported. */
  error: string | null;
}

/** The two marks only the room knows, carried to the next line it speaks. */
export interface RoomMarks {
  answer_sent_at: number | null;
  first_token_at: number | null;
}

export const NO_MARKS: RoomMarks = { answer_sent_at: null, first_token_at: null };

/** Now, on the page's monotonic clock, as epoch milliseconds. */
export function nowMs(): number {
  return Math.round(performance.timeOrigin + performance.now());
}

/** A record for a line that has just reached the room. */
export function newLine(init: {
  id: string;
  key: string;
  voiceName: string | null;
  rate: number;
  lineChars: number;
  landedAt: number;
  marks?: RoomMarks;
}): LineTiming {
  const marks = init.marks ?? NO_MARKS;
  return {
    id: init.id,
    key: init.key,
    tier: "browser",
    voice_name: init.voiceName,
    rate: init.rate,
    line_chars: init.lineChars,
    heard_chars: null,
    answer_sent_at: marks.answer_sent_at,
    first_token_at: marks.first_token_at,
    landed_at: init.landedAt,
    first_audio_at: null,
    ended_at: null,
    stop_requested_at: null,
    stopped_at: null,
    stop_reason: null,
    speech_started_at: null,
    contested: false,
    blocked: false,
    error: null,
  };
}

/** Where each sentence starts in the line it was cut from, so a word
 *  boundary inside sentence 3 can be placed in the whole line. */
export function chunkOffsets(line: string, chunks: readonly string[]): number[] {
  let from = 0;
  return chunks.map((chunk) => {
    const at = line.indexOf(chunk, from);
    const start = at < 0 ? from : at;
    from = start + chunk.length;
    return start;
  });
}

/** Characters heard through the word now being said — the spec's rule is to
 *  keep "the word covering that position" (§6.5). */
export function heardThrough(chunkStart: number, charIndex: number, charLength: number | undefined): number {
  return chunkStart + charIndex + (charLength ?? 0);
}

/** Where a line's record goes: M11's ledger for the interview it was said in. */
export function timingsPath(sessionId: string): string {
  return `/v1/voice/${encodeURIComponent(sessionId)}/timings`;
}

/** A line id. `crypto.randomUUID` needs a secure context; dev on a LAN IP is not one. */
export function lineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, "0");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}
