/**
 * The WAV a recogniser receives (src/voice/wav.ts), checked byte by byte.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 */
import assert from "node:assert/strict";

import { ASR_RATE, encodeWav, joinSamples } from "../src/voice/wav.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("a 16 kHz mono 16-bit WAV, header and all", () => {
  const samples = Int16Array.from([0, 1000, -1000, 32767, -32768]);
  const wav = encodeWav(samples);
  const view = new DataView(wav.buffer);
  const text = (at: number, n: number) => String.fromCharCode(...wav.slice(at, at + n));
  assert.equal(wav.length, 44 + samples.length * 2);
  assert.equal(text(0, 4), "RIFF");
  assert.equal(view.getUint32(4, true), 36 + samples.length * 2);
  assert.equal(text(8, 4), "WAVE");
  assert.equal(text(12, 4), "fmt ");
  assert.equal(view.getUint16(20, true), 1, "PCM");
  assert.equal(view.getUint16(22, true), 1, "mono");
  assert.equal(view.getUint32(24, true), ASR_RATE);
  assert.equal(view.getUint32(28, true), ASR_RATE * 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(text(36, 4), "data");
  assert.equal(view.getUint32(40, true), samples.length * 2);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true)),
    [0, 1000, -1000, 32767, -32768],
  );
});

test("frames gathered one by one join in order", () => {
  const joined = joinSamples([Int16Array.from([1, 2]), Int16Array.from([]), Int16Array.from([3])]);
  assert.deepEqual([...joined], [1, 2, 3]);
});

console.log(`\n${passed} passed`);
