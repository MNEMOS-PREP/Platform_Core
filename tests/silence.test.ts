/**
 * When the interviewer answers (src/voice/silence.ts) and the first chunk
 * (core.ts firstClause), pinned.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 */
import assert from "node:assert/strict";

import { clauses, firstClause, sentencesOf } from "../src/voice/core.ts";
import { deliberateMs, naturalGapMs, silenceBeforeMs } from "../src/voice/silence.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("the natural gap is a person's: 300-900 ms, longer for the patient", () => {
  for (let i = 0; i < 200; i++) {
    const gap = naturalGapMs(i % 2 ? 0.9 : 0.2, `line-${i}`);
    assert.ok(gap >= 300 && gap <= 900, String(gap));
  }
  const patient = naturalGapMs(0.9, "same"), brisk = naturalGapMs(0.2, "same");
  assert.ok(patient > brisk, `${patient} vs ${brisk}`);
  assert.equal(naturalGapMs(0.6, "k"), naturalGapMs(0.6, "k"), "the same line waits the same");
});

test("only Final Boss holds a silence, before about one new question in three", () => {
  let held = 0;
  for (let i = 0; i < 300; i++) {
    const key = `q-${i}`;
    assert.equal(deliberateMs({ patience: 0.4, mode: "mock", key, newQuestion: true }), 0);
    assert.equal(deliberateMs({ patience: 0.4, mode: "final_boss", key, newQuestion: false }), 0);
    const ms = deliberateMs({ patience: 0.4, mode: "final_boss", key, newQuestion: true });
    if (ms > 0) {
      held += 1;
      assert.ok(ms >= 1800 && ms <= 3500, String(ms));
    }
  }
  assert.ok(held > 60 && held < 140, `held ${held} of 300`);
  const total = silenceBeforeMs({ patience: 0.4, mode: "practice", key: "x", newQuestion: true });
  assert.ok(total <= 900);
});

test("a long first sentence is cut at its first clause; a short one is not", () => {
  assert.deepEqual(firstClause("Okay, let's leave that there."), ["Okay, let's leave that there."]);
  const long =
    "Thanks, Priya, so tell me about the civic grievance system you built, and how it routes the complaints it receives.";
  const [head, tail] = firstClause(long);
  assert.ok(head && tail, "cut in two");
  assert.ok(head!.endsWith(","), head);
  assert.equal(`${head} ${tail}`, long);
  const { sentences } = sentencesOf(`${long} Take your time.`, { personaId: null, voiceId: null });
  assert.deepEqual(sentences.map((s) => s.text), [head, tail, "Take your time."]);
});

test("long sentences are cut at their clauses, so M11 makes the pieces side by side (v0.26.0)", () => {
  const short = "Tell me about the system you built.";
  assert.deepEqual(clauses(short), [short]);
  const question =
    "Can you describe, in your own words, what the automated evaluation harness you built does and what problem it was intended to solve?";
  const pieces = clauses(question);
  assert.equal(pieces.length, 2, pieces.join(" | "));
  assert.equal(pieces.join(" "), question, "nothing lost or reordered");
  for (const piece of pieces) assert.ok(piece.split(/\s+/).length >= 4, piece);
  // Cut where the halves balance, and again while a half is still long.
  const longer =
    "We built it in three weeks, the team was small, the data was messy and late, and still the pipeline shipped on time with every check green.";
  const cut = clauses(longer);
  assert.ok(cut.length >= 3, cut.join(" | "));
  assert.equal(cut.join(" "), longer);
  // No clause boundary: it stays whole rather than being cut mid-phrase.
  const plain = "Walk me through how the classifier decides which department receives each complaint it is given";
  assert.deepEqual(clauses(plain), [plain]);
});

test("a part's pause falls after its last sentence", () => {
  const { sentences } = sentencesOf(
    [
      { text: "Let me note that down.", pauseAfterMs: 1500, id: "a" },
      { text: "Next question. What is a heap?", id: "b" },
    ],
    { personaId: null, voiceId: null },
  );
  assert.deepEqual(
    sentences.map((s) => [s.partId, s.pauseAfterMs]),
    [["a", 1500], ["b", 0], ["b", 0]],
  );
});

console.log(`\n${passed} passed`);
