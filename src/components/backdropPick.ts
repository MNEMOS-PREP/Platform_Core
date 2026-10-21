/**
 * Which room an interviewer sits in, this interview (v0.39.0, 2026-10-21).
 *
 * The user: "around a hundred backgrounds for the 39–40 interviewers, each
 * getting a random one every time". So the choice is seeded by the interview,
 * not the person: the same interview always seats a person in the same room
 * (a reload does not redecorate), the next interview usually does not, and
 * two people on one panel never share a room while there are rooms to spare.
 *
 * Pure, so it is tested without a browser.
 */

/** A number in [0, 1) for this text: the same text, the same number. */
export function unit(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  // One round of mixing, so ids differing in one character land far apart.
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The room for `persona` in the interview `seed`, from `pool`, avoiding the
 * rooms already `taken` by others on the panel. Null when the pool is empty.
 */
export function pickRoom(
  pool: readonly string[],
  seed: string,
  persona: string,
  taken: ReadonlySet<string> = new Set(),
): string | null {
  if (pool.length === 0) return null;
  const start = Math.floor(unit(`${seed}:${persona}`) * pool.length) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const room = pool[(start + i) % pool.length]!;
    if (!taken.has(room)) return room;
  }
  return pool[start]!;
}
