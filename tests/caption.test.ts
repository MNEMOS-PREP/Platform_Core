/**
 * Live captions from M11's recogniser (src/voice/caption.ts), pinned.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 */
import assert from "node:assert/strict";

import { CAPTION_EVERY_MS, CAPTION_WINDOW_MS, captionFrom, UNSURE_BELOW } from "../src/voice/captionWords.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const result = {
  text: "it hashes the key",
  words: [
    { word: "it", start_ms: 0, end_ms: 100, confidence: 0.9 },
    { word: "hashes", start_ms: 100, end_ms: 400, confidence: 0.3 },
    { word: "the", start_ms: 400, end_ms: 500, confidence: 0.9 },
    { word: "key", start_ms: 500, end_ms: 800, confidence: 0.9 },
  ],
  duration_ms: 900,
  language: "english",
  mean_confidence: 0.75,
  low_confidence_spans: [[100, 400]] as [number, number][],
  speech_start_ms: 0,
  speech_end_ms: 800,
  model: "whisper-large-v3-turbo",
  latency_ms: 400,
};

test("unsure words are marked, as the words of record mark them (spec §8)", () => {
  const caption = captionFrom(result, false);
  assert.deepEqual(
    caption.words.map((w) => [w.word, w.unsure]),
    [["it", false], ["hashes", true], ["the", false], ["key", false]],
  );
  assert.equal(UNSURE_BELOW, 0.45, "M11's own line (asr.py LOW_CONFIDENCE)");
});

test("a long turn is captioned from its last ten seconds, every 2.5", () => {
  assert.equal(captionFrom(result, true).truncated, true);
  assert.equal(CAPTION_WINDOW_MS, 10_000);
  assert.equal(CAPTION_EVERY_MS, 2_500);
});

console.log(`\n${passed} passed`);
