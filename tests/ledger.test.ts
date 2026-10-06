/**
 * The latency ledger's browser half (src/voice/ledger.ts), pinned.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 *
 * What is measured is only as good as where a word is placed: a barge-in at
 * the third sentence must say how much of the WHOLE line was heard, not of
 * the sentence the browser happened to be on.
 */
import assert from "node:assert/strict";

import { speakable, splitSentences } from "../src/voice/core.ts";
import { NO_MARKS, chunkOffsets, heardThrough, lineId, newLine, timingsPath } from "../src/voice/ledger.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("each sentence is placed where it starts in the whole line", () => {
  const line = speakable("Hi, I'm Meera. We'll keep this conversational.   Why is lookup O(1)?");
  const chunks = splitSentences(line);
  const offsets = chunkOffsets(line, chunks);
  assert.equal(chunks.length, 3);
  chunks.forEach((chunk, i) => assert.equal(line.slice(offsets[i], offsets[i]! + chunk.length), chunk));
});

test("a sentence repeated inside a line is placed at its own occurrence, not the first", () => {
  const line = "Go on. Go on. Why?";
  assert.deepEqual(chunkOffsets(line, ["Go on.", "Go on.", "Why?"]), [0, 7, 14]);
});

test("a long sentence cut in two still adds up to the line", () => {
  const long = "word ".repeat(80).trim() + ".";
  const chunks = splitSentences(long);
  assert.ok(chunks.length > 1);
  const offsets = chunkOffsets(long, chunks);
  const last = chunks.length - 1;
  assert.equal(offsets[last]! + chunks[last]!.length, long.length);
});

test("heard through the word being said — the spec keeps the word covering the position", () => {
  // Sentence 2 starts at 15; the browser reports "keep" at index 6, length 4.
  assert.equal(heardThrough(15, 6, 4), 25);
  // A browser that gives no length still places the start of the word.
  assert.equal(heardThrough(15, 6, undefined), 21);
});

test("a new line carries the room's marks, and only when given", () => {
  const plain = newLine({ id: "a", key: "t1", voiceName: null, rate: 1, lineChars: 10, landedAt: 5 });
  assert.equal(plain.answer_sent_at, null);
  assert.equal(plain.first_audio_at, null);
  assert.equal(plain.tier, "browser");
  const answered = newLine({
    id: "b",
    key: "t2",
    voiceName: "Neerja",
    rate: 0.97,
    lineChars: 10,
    landedAt: 900,
    marks: { answer_sent_at: 100, first_token_at: 400, speech_ended_at: 40 },
  });
  assert.equal(answered.answer_sent_at, 100);
  assert.equal(answered.first_token_at, 400);
  assert.equal(answered.speech_ended_at, 40, "a spoken answer says where its speech ended");
  assert.equal(plain.speech_ended_at, null);
  assert.deepEqual(NO_MARKS, { answer_sent_at: null, first_token_at: null, speech_ended_at: null });
});

test("line ids are UUIDs, which the server takes as its idempotency key", () => {
  const ids = new Set(Array.from({ length: 50 }, () => lineId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("a record goes to the interview it was said in, on M11's noun", () => {
  assert.equal(timingsPath("5d0c"), "/v1/voice/5d0c/timings");
  assert.equal(timingsPath("a/b"), "/v1/voice/a%2Fb/timings");
});

console.log(`\n${passed} passed`);
