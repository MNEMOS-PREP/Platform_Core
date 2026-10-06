/**
 * When has the student finished? (src/voice/endpoint.ts), pinned.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 */
import assert from "node:assert/strict";

import {
  DEFAULT_ENDPOINT,
  adaptiveSilenceMs,
  decide,
  initialEndpoint,
  modelSaid,
  speechEnded,
  speechStarted,
  turnTaken,
} from "../src/voice/endpoint.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("the spec's threshold: 550 ms, moved by the speaker's own pauses, kept in 400-1,400", () => {
  assert.equal(adaptiveSilenceMs([]), 550);
  assert.equal(adaptiveSilenceMs([250, 250]), 550);
  assert.equal(adaptiveSilenceMs([500, 500]), 850, "§6.2: pauses of 500 ms get ~850");
  assert.equal(adaptiveSilenceMs([100]), 400, "never below 400");
  assert.equal(adaptiveSilenceMs([2000]), 1400, "never above 1,400");
});

test("a pause the student comes back from is learned; a breath is not", () => {
  let s = speechStarted(initialEndpoint(), 0);
  s = speechEnded(s, 2000);
  s = speechStarted(s, 2600); // a 600 ms pause, mid-answer
  s = speechEnded(s, 5000);
  s = speechStarted(s, 5100); // 100 ms: a breath
  assert.deepEqual(s.pauses, [600]);
  assert.equal(s.startedAt, 0, "still the same turn");
  assert.equal(adaptiveSilenceMs(s.pauses), 970);
});

test("without a turn model, the silence alone ends the turn at the threshold", () => {
  let s = speechStarted(initialEndpoint(), 1000);
  s = speechEnded(s, 4000);
  assert.deepEqual(decide(s, 4300, false), { kind: "wait", until: 4550 });
  const end = decide(s, 4550, false);
  assert.equal(end.kind, "end");
  if (end.kind === "end") {
    assert.equal(end.startedAt, 1000);
    assert.equal(end.endedAt, 4000, "the turn ended when the speech did");
    assert.equal(end.how, "silence");
  }
});

test("with a turn model, the threshold is when to ask, and 'finished' ends it", () => {
  let s = speechStarted(initialEndpoint(), 0);
  s = speechEnded(s, 3000);
  assert.deepEqual(decide(s, 3550, true), { kind: "ask", quietSince: 3000 });
  const { decision } = modelSaid(s, 3000, true, 3580);
  assert.equal(decision.kind, "end");
  if (decision.kind === "end") assert.equal(decision.how, "model");
});

test("'not finished' waits 600 ms more and asks again — never past 2.5 s of silence", () => {
  let s = speechStarted(initialEndpoint(), 0);
  s = speechEnded(s, 3000);
  let out = modelSaid(s, 3000, false, 3580);
  assert.deepEqual(out.decision, { kind: "wait", until: 4180 });
  s = out.state;
  assert.deepEqual(decide(s, 4180, true), { kind: "ask", quietSince: 3000 });
  out = modelSaid(s, 3000, false, 5300);
  assert.deepEqual(out.decision, { kind: "wait", until: 5500 }, "capped at 3000 + 2500");
  const end = decide(out.state, 5500, true);
  assert.equal(end.kind, "end");
  if (end.kind === "end") assert.equal(end.how, "silence");
});

test("an answer about a silence the student has since broken is ignored", () => {
  let s = speechStarted(initialEndpoint(), 0);
  s = speechEnded(s, 3000);
  s = speechStarted(s, 3400); // they carried on while the model was thinking
  assert.deepEqual(modelSaid(s, 3000, true, 3600).decision, { kind: "none" });
  assert.equal(decide(s, 3600, true).kind, "none", "speaking: nothing to decide");
});

test("the next turn starts fresh but keeps the speaker's pauses", () => {
  let s = speechStarted(initialEndpoint(), 0);
  s = speechEnded(s, 1000);
  s = speechStarted(s, 1700);
  s = speechEnded(s, 3000);
  const next = turnTaken(s);
  assert.equal(next.startedAt, null);
  assert.deepEqual(next.pauses, [700]);
  assert.equal(DEFAULT_ENDPOINT.capMs, 2500);
});

test("a long answer's pause between sentences is waited out (v0.24.0)", () => {
  // Five seconds of explanation, then the ~700 ms a student pauses between
  // two sentences: the live run answered here. Now the model is not asked
  // until a full second of quiet.
  let s = speechStarted(initialEndpoint(), 0);
  s = speechEnded(s, 5000);
  assert.deepEqual(decide(s, 5700, true), { kind: "wait", until: 6000 });
  assert.deepEqual(decide(s, 6000, true), { kind: "ask", quietSince: 5000 });
  // A short answer is still answered at the spec's 550.
  let short = speechStarted(initialEndpoint(), 0);
  short = speechEnded(short, 1800);
  assert.deepEqual(decide(short, 2350, true), { kind: "ask", quietSince: 1800 });
});

test("a turn taken too soon is learned from, and counted (v0.24.0)", () => {
  let s = speechStarted(initialEndpoint(), 0);
  s = speechEnded(s, 5000);
  s = turnTaken(s, { endedAt: 5000, takenAt: 6100 });
  // They carry on 1.2 s after the silence began, 0.1 s after it was taken.
  s = speechStarted(s, 6200);
  assert.deepEqual(s.pauses, [1200]);
  assert.equal(s.cutShort, 1);
  assert.equal(adaptiveSilenceMs(s.pauses), 1400, "the next pause is waited out");
  // Speech long after a turn is a new turn, not a continuation.
  let t = speechStarted(initialEndpoint(), 0);
  t = speechEnded(t, 2000);
  t = turnTaken(t, { endedAt: 2000, takenAt: 2600 });
  t = speechStarted(t, 9000);
  assert.deepEqual(t.pauses, []);
  assert.equal(t.cutShort, 0);
  // Without the times, nothing is assumed.
  const u = speechStarted(turnTaken(speechEnded(speechStarted(initialEndpoint(), 0), 2000)), 2100);
  assert.equal(u.cutShort, 0);
});

console.log(`\n${passed} passed`);
