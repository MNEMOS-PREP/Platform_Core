/** Shared formatting helpers. */

export function relativeDays(iso: string | null | undefined): string {
  if (!iso) return "date unknown";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.floor(months / 12)} years ago`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
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
