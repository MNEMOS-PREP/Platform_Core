/** Shared formatting helpers. */

/**
 * A server's timestamp as the instant it is (v0.41.0).
 *
 * Every module writes UTC, and SQLite hands a timestamp back without its zone
 * ("2026-10-22T19:51:04"), which a browser reads as LOCAL time: 5½ hours off
 * in India, enough to put a 1 a.m. interview on the day before and break a
 * streak. So a timestamp with no zone is UTC. A date alone ("2026-10-22") is
 * that calendar day where the student is, not midnight in London.
 */
export function instant(iso: string): Date {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  const zoned = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/.test(iso);
  return new Date(zoned ? iso : `${iso.replace(" ", "T")}Z`);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "today", "yesterday", "3 days ago" — in calendar days where the student is,
 *  not 24-hour blocks: an answer at 11 last night is "yesterday" at 8 this
 *  morning (until v0.41.0 it was "today"). */
export function relativeDays(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "date unknown";
  const then = instant(iso);
  if (Number.isNaN(then.getTime())) return "date unknown";
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.floor(months / 12)} years ago`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return instant(iso).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

/**
 * Counts, never percentages.
 *
 * At n = 11 a percentage fabricates precision we do not have, and students read
 * "70%" as a property of the company rather than of our sample (M15 §8).
 */
export function reportCount(n: number): string {
  return `${n} report${n === 1 ? "" : "s"}`;
}

/**
 * "How did I do?" in words, for ONE answer (v0.13.0).
 *
 * A number per answer would read as a calibrated score, and none is calibrated
 * yet; no verdict at all left students with no sense of progress. A band is
 * the honest middle: it is the fraction of a strong answer's key points the
 * answer covered, said in three words, and every module that shows an answer
 * says it the same way. The colours are the skill graph's (strong, solid,
 * needs work), so the two read as one vocabulary.
 */
export type AnswerBand = "strong" | "partly" | "not_yet";

export const ANSWER_BAND_LABEL: Record<AnswerBand, string> = {
  strong: "Strong",
  partly: "Partly there",
  not_yet: "Not yet",
};

/** `covered` of `total` key points, or a 0–1 fraction when `total` is omitted. */
export function answerBand(covered: number, total?: number): AnswerBand | null {
  const fraction = total === undefined ? covered : total > 0 ? covered / total : NaN;
  if (!Number.isFinite(fraction)) return null;
  if (fraction >= 0.75) return "strong";
  if (fraction >= 0.4) return "partly";
  return "not_yet";
}
