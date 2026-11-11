/**
 * The list of interviewers with a face, asked of M11 — pure, so it can be
 * tested without a browser (`useInterviewerFaces` is the hook over it).
 *
 * Only an ANSWER is kept. Until 2026-11-10 a failed ask was kept too: a page
 * opened while M11 was still loading its models — M11 is the slowest service
 * to start, and the platform opens the shell before it is ready — showed every
 * interviewer as initials until a full reload, though M11 was up seconds later
 * (the viva's examiners, found live). Now a failure is forgotten and asked
 * again, sooner at first and then every half minute.
 */

/** Waits between asks after a failure, ms; the last one repeats. */
export const FACES_RETRY_MS = [2_000, 5_000, 10_000, 20_000, 30_000] as const;

export function facesRetryDelay(attempt: number): number {
  return FACES_RETRY_MS[Math.min(attempt, FACES_RETRY_MS.length - 1)]!;
}

/** `ask()` resolves to the personas with a face, or null when M11 could not
 *  be asked. A real answer — even an empty list — is kept for good; a
 *  failure is not, and concurrent asks share one request. */
export function facesCache(
  fetchFaces: () => Promise<readonly string[]>,
): () => Promise<ReadonlySet<string> | null> {
  let found: ReadonlySet<string> | null = null;
  let inFlight: Promise<ReadonlySet<string> | null> | null = null;
  return () => {
    if (found) return Promise.resolve(found);
    inFlight ??= fetchFaces()
      .then((personas) => (found = new Set(personas)))
      .catch(() => null)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
