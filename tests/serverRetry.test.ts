/**
 * One failed sentence is that sentence's failure (src/voice/serverRetry.ts,
 * good_and_bads #1, 2026-11-22): asked for once more before the browser's
 * voice takes over, and never once the line has been stopped.
 *
 *   npm test
 */
import { retryOnce } from "../src/voice/serverRetry.ts";

const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : " want " + JSON.stringify(want)}`);
  if (!ok) process.exitCode = 1;
};

let calls = 0;
check("a second try that works is the sentence", await retryOnce(async () => (++calls, "clip")), "clip");
check("asked once", calls, 1);

check("fails again: null, and the browser takes the rest of the line", await retryOnce(async () => {
  throw new Error("M11 500");
}), null);

const stopped = new AbortController();
stopped.abort();
calls = 0;
check("a stopped line is not asked again", await retryOnce(async () => (++calls, "clip"), stopped.signal), null);
check("not even once", calls, 0);
