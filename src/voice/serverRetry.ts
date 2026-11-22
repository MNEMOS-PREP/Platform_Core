/**
 * One failed sentence is that sentence's failure, not the room's
 * (good_and_bads #1, 2026-11-22).
 *
 * Until then a single sentence M11 could not make sent the rest of the line,
 * and every line after it, to the browser's own voice for the rest of the
 * interview: on 15 Nov one failure meant a worse voice for the whole session,
 * and the recordings went silent. Now the sentence is asked for once more; only
 * if that fails too does the rest of THIS line go to the browser, and the next
 * line asks M11 again (useInterviewerVoice's `upgradable`).
 */

/** `make()` once more, unless the line was stopped. Null when it fails again. */
export async function retryOnce<T>(make: () => Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (signal?.aborted) return null;
  try {
    return await make();
  } catch {
    return null;
  }
}
