/**
 * The face's frames, read by the audio's clock (src/voice/face.ts), pinned.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 */
import assert from "node:assert/strict";

import {
  ARKIT_NAMES,
  FACE_LOOKAHEAD_S,
  REST,
  blinker,
  blinkShape,
  faceDriver,
  headPose,
  jawOnly,
  settle,
  weightsAt,
  type FaceFrames,
} from "../src/voice/face.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const close = (actual: number | undefined, expected: number, message?: string) =>
  assert.ok(Math.abs((actual ?? NaN) - expected) < 1e-9, `${message ?? ""} ${actual} != ${expected}`);

const face: FaceFrames = {
  fps: 30,
  names: ["jawOpen", "mouthClose"],
  frames: Array.from({ length: 60 }, (_, i) => [i / 100, 1 - i / 100]),
};

test("the frame is the one for the audio's time, a frame ahead", () => {
  close(weightsAt(face, 1.0).jawOpen, 31 / 100, "1.0 s plus one frame of lookahead is frame 31");
  close(weightsAt(face, 1.0, 0).jawOpen, 30 / 100);
  assert.ok(FACE_LOOKAHEAD_S > 0 && FACE_LOOKAHEAD_S < 0.1);
});

test("between two frames, the face is between them", () => {
  close(weightsAt(face, 1.0 + 0.5 / 30, 0).jawOpen, 0.305);
  close(weightsAt(face, 1.0 + 0.25 / 30, 0).mouthClose, 1 - 0.3025);
});

test("before the start and past the end, the nearest frame", () => {
  assert.equal(weightsAt(face, -1).jawOpen, 0);
  close(weightsAt(face, 99).jawOpen, 59 / 100, "a sentence ends at rest");
});

test("every name gets its value", () => {
  assert.deepEqual(Object.keys(weightsAt(face, 0.5)).sort(), ["jawOpen", "mouthClose"]);
  assert.deepEqual(weightsAt({ fps: 30, names: ["jawOpen"], frames: [] }, 1), {});
});

test("with no frames the jaw follows how open the mouth is, within range", () => {
  assert.equal(jawOnly(0).jawOpen, 0);
  assert.ok(jawOnly(1).jawOpen! > jawOnly(0.5).jawOpen!);
  assert.equal(jawOnly(5).jawOpen, jawOnly(1).jawOpen, "never past fully open");
  for (const v of Object.values(jawOnly(1))) assert.ok(v >= 0 && v <= 1);
});

test("rest is all 52 ARKit channels at zero", () => {
  assert.equal(ARKIT_NAMES.length, 52);
  assert.equal(new Set(ARKIT_NAMES).size, 52);
  assert.deepEqual(Object.keys(REST).sort(), [...ARKIT_NAMES].sort());
  assert.ok(Object.values(REST).every((v) => v === 0));
});

test("a face settles to rest the way it was open, and gets there", () => {
  const open = { jawOpen: 0.4, mouthFunnel: 0.2 };
  const after = settle(open, 0.05);
  assert.ok(after.jawOpen! < 0.4 && after.jawOpen! > 0);
  close(after.jawOpen! / after.mouthFunnel!, 2, "every channel by the same share");
  assert.equal(settle(open, 1).jawOpen, 0, "shut within a second");
  assert.deepEqual(settle(open, 0), open, "no time, no change");
});

test("a blink falls fast, lifts slower, and never quite to fully shut", () => {
  assert.equal(blinkShape(-1), 0);
  assert.equal(blinkShape(400), 0);
  const peak = Math.max(...Array.from({ length: 261 }, (_, ms) => blinkShape(ms)));
  close(peak, 0.95);
  assert.ok(blinkShape(40) > blinkShape(80 + 90) - 0.2, "half shut at 40 ms on the way down");
  // Half-way down takes less time than half-way back up.
  const down = Array.from({ length: 261 }, (_, ms) => ms).find((ms) => blinkShape(ms) >= 0.475)!;
  const up = Array.from({ length: 261 }, (_, ms) => ms).reverse().find((ms) => blinkShape(ms) >= 0.475)! - 80;
  assert.ok(down < up, `${down} ms down vs ${up} ms up`);
});

test("faces blink about sixteen times a minute, each its own way", () => {
  const count = (seed: string) => {
    const lids = blinker(seed);
    let blinks = 0;
    let shut = false;
    for (let ms = 0; ms < 600_000; ms += 10) {
      const now = lids(ms / 1000) > 0.5;
      if (now && !shut) blinks += 1;
      shut = now;
    }
    return blinks / 10;
  };
  const a = count("professor");
  const b = count("bar_raiser");
  assert.ok(a >= 12 && a <= 22, `professor blinks ${a} a minute`);
  assert.ok(b >= 12 && b <= 22, `bar_raiser blinks ${b} a minute`);
  const first = blinker("professor");
  const again = blinker("professor");
  const other = blinker("bar_raiser");
  let same = true;
  let differs = false;
  for (let ms = 0; ms < 60_000; ms += 10) {
    if (first(ms / 1000) !== again(ms / 1000)) same = false;
    if (blinker("professor")(ms / 1000) !== other(ms / 1000)) differs = true;
  }
  assert.ok(same, "one face blinks the same way twice");
  assert.ok(differs, "two faces do not blink together");
});

test("the head moves only while speaking or listening, and only a little", () => {
  assert.equal(headPose(3, 0.2, 0.1, 0, 0, 1), null, "idle: the clip alone");
  const limit = (5 * Math.PI) / 180;
  for (let s = 0; s < 30; s += 0.05) {
    for (const [open, usual] of [[0, 0], [0.4, 0], [0.2, 0.2], [1, 0]]) {
      for (const pose of [headPose(s, open!, usual!, 1, 0, 2), headPose(s, open!, usual!, 0, 1, 2)]) {
        for (const angle of pose!.head) assert.ok(Math.abs(angle) <= limit, `${angle} at ${s}s`);
      }
    }
  }
  const plain = headPose(2, 0.1, 0.1, 1, 0, 0)!.head[0];
  const stressed = headPose(2, 0.25, 0.1, 1, 0, 0)!.head[0];
  assert.ok(stressed > plain, "a stressed word nods the chin down");
});

test("every frame names all 52 channels, speech passes through untouched", () => {
  const driver = faceDriver("professor");
  const speech = { jawOpen: 0.3, mouthFunnel: 0.12 };
  const frame = driver.frame(10, speech, false);
  assert.deepEqual(Object.keys(frame).sort(), [...ARKIT_NAMES].sort());
  assert.equal(frame.jawOpen, 0.3, "the lip sync is the audio's: no easing");
  assert.equal(frame.mouthFunnel, 0.12);
  assert.equal(frame.mouthSmileLeft, 0);
});

test("a speaker cut off mid-word closes their mouth (it used to stay open)", () => {
  const driver = faceDriver("professor");
  let now = 100;
  for (let i = 0; i < 30; i++, now += 1 / 60) driver.frame(now, { jawOpen: 0.5, mouthLowerDownLeft: 0.4 }, false);
  const cut = driver.frame(now, null, false);
  assert.ok(cut.jawOpen! > 0.3, "eased, not snapped, the frame it stops");
  for (let i = 0; i < 24; i++) driver.frame((now += 1 / 60), null, false);
  const later = driver.frame((now += 1 / 60), null, false);
  assert.ok(later.jawOpen! < 0.01, `shut within ~0.4 s: ${later.jawOpen}`);
  assert.ok(later.mouthLowerDownLeft! < 0.01);
});

test("the head eases in when speech starts and out when it stops", () => {
  const driver = faceDriver("professor");
  let now = 0;
  driver.frame(now, null, false);
  assert.equal(driver.pose(), null, "idle: the clip alone");
  driver.frame((now += 1 / 60), { jawOpen: 0.2 }, false);
  const first = driver.pose()!.head.map(Math.abs);
  assert.ok(first.every((angle) => angle < (0.3 * Math.PI) / 180), "no snap on the first frame");
  for (let i = 0; i < 120; i++) driver.frame((now += 1 / 60), { jawOpen: 0.2 }, false);
  assert.notEqual(driver.pose(), null);
  for (let i = 0; i < 600; i++) driver.frame((now += 1 / 60), null, false);
  assert.equal(driver.pose(), null, "back to the clip alone once quiet");
});

test("listening, the head nods now and then", () => {
  const driver = faceDriver("professor");
  let now = 0;
  let deepest = 0;
  for (let i = 0; i < 60 * 12; i++) {
    driver.frame((now += 1 / 60), null, true);
    deepest = Math.max(deepest, driver.pose()?.head[0] ?? 0);
  }
  assert.ok(deepest > (1.5 * Math.PI) / 180, `a nod of ${(deepest * 180) / Math.PI} degrees`);
});

test("faces blink while they speak too", () => {
  const driver = faceDriver("professor");
  let now = 0;
  let shut = 0;
  for (let i = 0; i < 60 * 12; i++) {
    const frame = driver.frame((now += 1 / 60), { jawOpen: 0.2, eyeBlinkLeft: 0, eyeBlinkRight: 0 }, false);
    shut = Math.max(shut, frame.eyeBlinkLeft!);
    assert.equal(frame.eyeBlinkLeft, frame.eyeBlinkRight, "both eyes together");
  }
  assert.ok(shut > 0.9);
});

console.log(`\n${passed} passed`);
