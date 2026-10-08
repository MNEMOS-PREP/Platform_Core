/**
 * The face's frames, read by the audio's clock (src/voice/face.ts), pinned.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 */
import assert from "node:assert/strict";

import { FACE_LOOKAHEAD_S, jawOnly, weightsAt, type FaceFrames } from "../src/voice/face.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const face: FaceFrames = {
  fps: 30,
  names: ["jawOpen", "mouthClose"],
  frames: Array.from({ length: 60 }, (_, i) => [i / 100, 1 - i / 100]),
};

test("the frame is the one for the audio's time, a frame ahead", () => {
  const at = weightsAt(face, 1.0);
  assert.equal(at.jawOpen, 31 / 100, "1.0 s plus one frame of lookahead is frame 31");
  assert.equal(weightsAt(face, 1.0, 0).jawOpen, 30 / 100);
  assert.ok(FACE_LOOKAHEAD_S > 0 && FACE_LOOKAHEAD_S < 0.1);
});

test("before the start and past the end, the nearest frame", () => {
  assert.equal(weightsAt(face, -1).jawOpen, 0);
  assert.equal(weightsAt(face, 99).jawOpen, 59 / 100, "a sentence ends at rest");
});

test("every name gets its value", () => {
  assert.deepEqual(Object.keys(weightsAt(face, 0.5)).sort(), ["jawOpen", "mouthClose"]);
  assert.deepEqual(weightsAt({ fps: 30, names: ["jawOpen"], frames: [] }, 1), {});
});

test("with no frames the jaw follows how open the mouth is, within range", () => {
  assert.equal(jawOnly(0).jawOpen, 0);
  assert.ok(jawOnly(1).jawOpen > jawOnly(0.5).jawOpen);
  assert.equal(jawOnly(5).jawOpen, jawOnly(1).jawOpen, "never past fully open");
  for (const v of Object.values(jawOnly(1))) assert.ok(v >= 0 && v <= 1);
});

console.log(`\n${passed} passed`);
