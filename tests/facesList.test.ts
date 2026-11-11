/**
 * The interviewers-with-a-face list (src/voice/facesList.ts), pinned: an answer
 * is kept, a failure is asked again.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 */
import assert from "node:assert/strict";

import { FACES_RETRY_MS, facesCache, facesRetryDelay } from "../src/voice/facesList.ts";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

await test("a failed ask is not kept: M11 coming up later is heard", async () => {
  let up = false;
  let calls = 0;
  const ask = facesCache(async () => {
    calls += 1;
    if (!up) throw new Error("502 — M11 still loading");
    return ["professor", "os_narayan"];
  });
  assert.equal(await ask(), null);
  up = true;
  const faces = await ask();
  assert.ok(faces?.has("professor"));
  assert.equal(calls, 2);
});

await test("an answer is kept: asked once however many rooms ask", async () => {
  let calls = 0;
  const ask = facesCache(async () => {
    calls += 1;
    return ["professor"];
  });
  await ask();
  await ask();
  assert.equal(calls, 1);
});

await test("an empty list is an answer, not a failure", async () => {
  let calls = 0;
  const ask = facesCache(async () => {
    calls += 1;
    return [];
  });
  assert.equal((await ask())?.size, 0);
  await ask();
  assert.equal(calls, 1);
});

await test("asks at the same moment share one request", async () => {
  let calls = 0;
  const ask = facesCache(async () => {
    calls += 1;
    return ["professor"];
  });
  await Promise.all([ask(), ask(), ask()]);
  assert.equal(calls, 1);
});

await test("retries come sooner at first, then every half minute", () => {
  assert.equal(facesRetryDelay(0), 2_000);
  assert.ok(facesRetryDelay(1) > facesRetryDelay(0));
  assert.equal(facesRetryDelay(99), FACES_RETRY_MS[FACES_RETRY_MS.length - 1]);
});

console.log(`\n${passed} passed`);
