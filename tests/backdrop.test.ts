/**
 * Which room an interviewer sits in (src/components/backdropPick.ts), pinned.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 */
import assert from "node:assert/strict";

import { pickRoom, unit } from "../src/components/backdropPick.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const ROOMS = Array.from({ length: 100 }, (_, i) => `/v1/voice/backdrops/room-${i}.webp`);

test("the same interview seats a person in the same room", () => {
  assert.equal(pickRoom(ROOMS, "session-a", "ml_varun"), pickRoom(ROOMS, "session-a", "ml_varun"));
});

test("a person's room changes from one interview to the next", () => {
  const rooms = new Set(Array.from({ length: 20 }, (_, i) => pickRoom(ROOMS, `session-${i}`, "ml_varun")));
  assert.ok(rooms.size >= 15, `only ${rooms.size} rooms in 20 interviews`);
});

test("forty interviewers across many interviews use most of the hundred rooms", () => {
  const used = new Set<string>();
  for (let s = 0; s < 10; s++) for (let p = 0; p < 40; p++) used.add(pickRoom(ROOMS, `s${s}`, `persona_${p}`)!);
  assert.ok(used.size >= 90, `only ${used.size} of 100 rooms used`);
});

test("two people on one panel never share a room", () => {
  for (let s = 0; s < 200; s++) {
    const taken = new Set<string>();
    for (const persona of ["ml_varun", "ml_deshpande", "hr_generalist", "professor"]) {
      const room = pickRoom(ROOMS, `panel-${s}`, persona, taken)!;
      assert.ok(!taken.has(room));
      taken.add(room);
    }
  }
});

test("no rooms, no pick; more people than rooms still get one", () => {
  assert.equal(pickRoom([], "s", "p"), null);
  const two = ["a", "b"];
  assert.ok(two.includes(pickRoom(two, "s", "p", new Set(two))!));
});

test("unit spreads ids that differ by one character", () => {
  assert.ok(Math.abs(unit("persona_1") - unit("persona_2")) > 0.01);
  assert.ok(unit("x") >= 0 && unit("x") < 1);
});

console.log(`\n${passed} passed`);
