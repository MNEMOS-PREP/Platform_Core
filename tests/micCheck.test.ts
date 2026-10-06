/**
 * The mic check and echo (src/voice/micCheck.ts), pinned.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 */
import assert from "node:assert/strict";

import { heardBack, isEcho, overlap, roomFrom } from "../src/voice/micCheck.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("a room's floor in words a student can act on", () => {
  assert.equal(roomFrom(-65), "quiet");
  assert.equal(roomFrom(-50), "some noise");
  assert.equal(roomFrom(-38), "noisy");
});

test("how much of the sentence read aloud came back", () => {
  const sentence = "I'm ready for my interview with the panel.";
  assert.equal(heardBack(sentence, "I'm ready for my interview with the panel."), 1);
  assert.ok(heardBack(sentence, "ready for my interview") > 0.4);
  assert.ok(heardBack(sentence, "I'm ready for my interview, with the panel") > 0.99, "punctuation is not a word");
  assert.equal(heardBack(sentence, ""), 0);
});

test("the interviewer's own words coming back through the mic are echo", () => {
  const asked = "Walk me through the classifier you built, and how you split the data.";
  assert.ok(isEcho("walk me through the classifier you built", asked));
  assert.ok(!isEcho("I used a held-out test set from a different hospital", asked));
  assert.ok(!isEcho("the classifier", asked), "two words are not enough to tell");
  assert.ok(overlap("you built the classifier", asked) < 1, "order matters");
});

console.log(`\n${passed} passed`);
