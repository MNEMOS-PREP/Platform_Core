/**
 * Hearing the student start to speak (src/voice/vad.ts), pinned.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 *
 * Frames are 20 ms, as `useListening` makes them. Levels are dBFS: a quiet
 * room with noise suppression on sits around -60; a student talking into a
 * laptop's microphone, -35 to -25.
 */
import assert from "node:assert/strict";

import { DEFAULT_VAD, dbOf, initialVad, stepVad, type VadEvent, type VadState } from "../src/voice/vad.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const FRAME = 20;

/** Speech-like: syllables rising and falling around `level`. */
const speech = (level: number) => (i: number) => level + 6 * Math.sin(i * 1.3);
const steady = (level: number) => () => level;

/** Run `frames` frames of `level(i)` from `from` ms; collect what happened. */
function run(
  state: VadState,
  from: number,
  frames: number,
  level: (i: number) => number,
  playing = false,
): { state: VadState; events: Exclude<VadEvent, null>[]; end: number } {
  const events: Exclude<VadEvent, null>[] = [];
  let s = state;
  for (let i = 0; i < frames; i++) {
    const out = stepVad(s, { db: level(i), at: from + i * FRAME, playing });
    s = out.state;
    if (out.event) events.push(out.event);
  }
  return { state: s, events, end: from + frames * FRAME };
}

test("a frame's level: full scale is 0 dB, silence is far below", () => {
  assert.equal(Math.round(dbOf([1, -1, 1, -1])), 0);
  assert.equal(Math.round(dbOf(new Array(480).fill(0.01))), -40);
  assert.ok(dbOf(new Array(480).fill(0)) <= -100);
});

test("a quiet room is never speech, and the floor settles on it", () => {
  const quiet = run(initialVad(), 0, 200, steady(-62));
  assert.deepEqual(quiet.events, []);
  assert.ok(Math.abs(quiet.state.floorDb - -62) < 1, String(quiet.state.floorDb));
});

test("speech is heard after 250 ms, and dated from its first loud frame", () => {
  const room = run(initialVad(), 0, 100, steady(-60));
  const talk = run(room.state, room.end, 30, speech(-30));
  assert.equal(talk.events.length, 1);
  const start = talk.events[0]!;
  assert.equal(start.kind, "start");
  if (start.kind !== "start") return;
  assert.equal(start.at, room.end, "dated from the first loud frame");
  assert.ok(start.decidedAt - start.at >= DEFAULT_VAD.sustainMs);
  assert.ok(start.decidedAt - start.at <= DEFAULT_VAD.sustainMs + FRAME);
});

test("a cough or a click is shorter than the sustain", () => {
  const room = run(initialVad(), 0, 100, steady(-60));
  const cough = run(room.state, room.end, 8, speech(-25)); // 160 ms
  const after = run(cough.state, cough.end, 50, steady(-60));
  assert.deepEqual([...cough.events, ...after.events], []);
});

test("a dip between syllables does not reset the sustain", () => {
  const room = run(initialVad(), 0, 100, steady(-60));
  // 120 ms loud, one 40 ms dip, 160 ms loud: one start.
  const word = run(room.state, room.end, 16, (i) => (i === 6 || i === 7 ? -60 : speech(-30)(i)));
  assert.equal(word.events.filter((e) => e.kind === "start").length, 1);
});

test("the interviewer's leftover echo does not stop them; the student does", () => {
  const room = run(initialVad(), 0, 100, steady(-60));
  // Echo 15 dB over the floor while the interviewer speaks: under the raised bar.
  const echo = run(room.state, room.end, 60, speech(-45), true);
  assert.deepEqual(echo.events, []);
  // The student, 30 dB over the floor, while the interviewer still speaks.
  const student = run(echo.state, echo.end, 20, speech(-30), true);
  assert.equal(student.events[0]?.kind, "start");
});

test("a fan switching on is learned as the room, not heard as speech", () => {
  const room = run(initialVad(), 0, 100, steady(-60));
  const fan = run(room.state, room.end, 150, steady(-42)); // 3 s of steady noise
  assert.deepEqual(fan.events, []);
  assert.ok(fan.state.floorDb > -50, `the floor rose to the fan: ${fan.state.floorDb}`);
  // And a student talking over the fan is still heard.
  const talk = run(fan.state, fan.end, 20, speech(-20));
  assert.equal(talk.events[0]?.kind, "start");
});

test("speech ends after the release, dated from its first quiet frame", () => {
  const room = run(initialVad(), 0, 100, steady(-60));
  const talk = run(room.state, room.end, 60, speech(-30));
  const quiet = run(talk.state, talk.end, 50, steady(-60));
  const end = quiet.events.find((e) => e.kind === "end");
  assert.ok(end, "an end");
  assert.equal(end!.at, talk.end);
  // Talking does not raise the floor against the talker.
  assert.ok(talk.state.floorDb < -55, String(talk.state.floorDb));
});

console.log(`\n${passed} passed`);
