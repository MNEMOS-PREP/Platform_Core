/**
 * A line's sound end to end (src/voice/track.ts), pinned: what is trimmed,
 * how long each pause is, and when a long line holds its first word.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 */
import assert from "node:assert/strict";

import { MAX_HOLD_S, Rate, endsSentence, holdFor, pauseBetween, sentenceEnd, trimBounds } from "../src/voice/track.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const RATE = 24_000;
/** Silence, a tone, silence: seconds each. */
function clip(lead: number, sound: number, trail: number, level = 0.3): Float32Array {
  const out = new Float32Array(Math.round((lead + sound + trail) * RATE));
  const from = Math.round(lead * RATE);
  const to = Math.round((lead + sound) * RATE);
  for (let i = from; i < to; i++) out[i] = level * Math.sin((2 * Math.PI * 220 * i) / RATE);
  return out;
}

test("a clip is cut to its sound, keeping a breath either side", () => {
  const { start, end } = trimBounds(clip(0.35, 1.5, 0.4), RATE);
  assert.ok(Math.abs(start - (0.35 - 0.02)) < 0.015, `start ${start}`);
  assert.ok(Math.abs(end - (1.85 + 0.06)) < 0.015, `end ${end}`);
});

test("a quiet tail inside the floor is still sound; below it, silence", () => {
  const samples = clip(0.1, 1, 0.5);
  // A soft decay after the word: -30 dB of the peak is kept, -60 dB is not.
  for (let i = Math.round(1.1 * RATE); i < Math.round(1.3 * RATE); i++) samples[i] = 0.3 * 0.03 * Math.sin(i / 3);
  for (let i = Math.round(1.3 * RATE); i < Math.round(1.5 * RATE); i++) samples[i] = 0.3 * 0.0008 * Math.sin(i / 3);
  const { end } = trimBounds(samples, RATE);
  assert.ok(end > 1.3 && end < 1.4, `end ${end}`);
});

test("silence alone, or a clip with no silence, is kept whole", () => {
  assert.deepEqual(trimBounds(new Float32Array(RATE), RATE), { start: 0, end: 1 });
  const { start, end } = trimBounds(clip(0, 1, 0), RATE);
  assert.equal(start, 0);
  assert.ok(Math.abs(end - 1) < 0.001);
});

test("a full stop pauses longer than a comma; a new speaker about 0.2 s", () => {
  const stop = pauseBetween("That makes sense.");
  const comma = pauseBetween("Can you walk me through it,");
  const turn = pauseBetween("Dr. Raghavan, over to you.", { sameSpeaker: false });
  assert.ok(stop > 0.25 && stop < 0.36, `${stop}`);
  assert.ok(comma > 0.08 && comma < 0.12, `${comma}`);
  assert.ok(turn > 0.18 && turn < 0.26, `${turn}`);
  assert.ok(pauseBetween("Is that right?") > comma);
});

test("a brisk speaker pauses less, a measured one more; the note-taking pause adds", () => {
  const plain = pauseBetween("Okay.");
  assert.ok(pauseBetween("Okay.", { manner: "brisk" }) < plain);
  assert.ok(pauseBetween("Okay.", { manner: "measured" }) > plain);
  assert.ok(Math.abs(pauseBetween("Okay.", { pauseAfterMs: 1500 }) - plain - 1.5) < 1e-9);
});

test("pauses vary a little, and the same words pause the same way", () => {
  assert.equal(pauseBetween("Right."), pauseBetween("Right."));
  assert.notEqual(pauseBetween("Right."), pauseBetween("Okay."));
});

test("made faster than it is heard, a line starts at once", () => {
  const pieces = [
    { seconds: 1.2, pauseAfter: 0.1 },
    { seconds: 3, pauseAfter: 0.3 },
    { seconds: 4, pauseAfter: 0 },
  ];
  assert.equal(holdFor(pieces, 3), 0);
  // At twice real time the 3-second second piece is made 1.5 s after the
  // first is ready, and needed 1.3 s after its first word: 0.2 s short.
  assert.ok(Math.abs(holdFor(pieces, 2) - 0.2) < 1e-9);
  assert.equal(holdFor([{ seconds: 2, pauseAfter: 0 }], 0.5), 0, "one piece: nothing to wait for");
});

test("made slower than speech, the first word waits the shortfall", () => {
  const pieces = [
    { seconds: 1, pauseAfter: 0.1 },
    { seconds: 2, pauseAfter: 0.3 },
    { seconds: 2, pauseAfter: 0 },
  ];
  // At 0.9 s of audio a second: piece 2 is made at 2.22 s, needed at 1.1 s
  // (1.12 s short); piece 3 made at 4.44 s, needed at 3.4 s (1.04 s short).
  assert.ok(Math.abs(holdFor(pieces, 0.9) - (2 / 0.9 - 1.1)) < 1e-9);
});

test("never more than a person's thinking pause", () => {
  const long = Array.from({ length: 8 }, () => ({ seconds: 3, pauseAfter: 0.3 }));
  assert.equal(holdFor(long, 0.5), MAX_HOLD_S);
  assert.equal(holdFor(long, 0), 0, "no rate known: no hold");
});

test("a sentence ends at its full stop, or where the speaker changes", () => {
  assert.ok(endsSentence("Is that right?") && endsSentence('He said "go."') && !endsSentence("Walk me through it,"));
  const pieces = [
    { text: "Thanks for making the time.", personaId: "a" },
    { text: "I'm joined by Ritu,", personaId: "a" },
    { text: "and we'll keep this conversational.", personaId: "a" },
    { text: "Hi, I'll be sitting in", personaId: "b" },
    { text: "and I might jump in.", personaId: "b" },
  ];
  assert.equal(sentenceEnd(pieces, 0), 0);
  assert.equal(sentenceEnd(pieces, 1), 2, "a comma cut is the same sentence");
  assert.equal(sentenceEnd(pieces, 3), 4);
  // Another speaker ends the span even without a full stop.
  assert.equal(sentenceEnd([{ text: "Over to you,", personaId: "a" }, { text: "Thanks.", personaId: "b" }], 0), 0);
});

test("a rate learns from what it sees, and ignores nonsense", () => {
  const rate = new Rate(1, 0.5);
  rate.update(2);
  assert.equal(rate.get(), 1.5);
  rate.update(Number.NaN);
  rate.update(-3);
  assert.equal(rate.get(), 1.5);
});

console.log(`\n${passed} passed`);
