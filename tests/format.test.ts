/**
 * Dates said the way a student lives them, and refusals said in words
 * (src/lib/format.ts, src/lib/detail.ts), pinned.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 */
import assert from "node:assert/strict";

import { detailOf } from "../src/lib/detail.ts";
import { instant, relativeDays } from "../src/lib/format.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("a timestamp with no zone is UTC, as every module writes it", () => {
  // SQLite's own form, and the same instant said with its zone.
  assert.equal(instant("2026-10-22T19:51:04.954538").getTime(), Date.UTC(2026, 9, 22, 19, 51, 4, 954));
  assert.equal(instant("2026-10-22 19:51:04").getTime(), Date.UTC(2026, 9, 22, 19, 51, 4));
  assert.equal(instant("2026-10-22T19:51:04Z").getTime(), Date.UTC(2026, 9, 22, 19, 51, 4));
  assert.equal(instant("2026-10-22T19:51:04+00:00").getTime(), Date.UTC(2026, 9, 22, 19, 51, 4));
  assert.equal(instant("2026-10-23T01:21:04+05:30").getTime(), Date.UTC(2026, 9, 22, 19, 51, 4));
});

test("a date alone is that calendar day where the student is", () => {
  const day = instant("2026-10-22");
  assert.deepEqual([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()], [2026, 9, 22, 0]);
});

test("yesterday is a calendar day, not 24 hours", () => {
  const morning = new Date(2026, 9, 26, 8, 0);
  const lastNight = new Date(2026, 9, 25, 23, 0).toISOString();
  assert.equal(relativeDays(lastNight, morning), "yesterday");
  assert.equal(relativeDays(new Date(2026, 9, 26, 0, 5).toISOString(), morning), "today");
  assert.equal(relativeDays(new Date(2026, 9, 23, 22, 0).toISOString(), morning), "3 days ago");
  assert.equal(relativeDays(null, morning), "date unknown");
  assert.equal(relativeDays("not a date", morning), "date unknown");
});

test("a refusal is words, whatever shape FastAPI sent it in", () => {
  assert.equal(detailOf({ detail: "Not signed in." }, "Forbidden"), "Not signed in.");
  const unprocessable = {
    detail: [
      { loc: ["body", "minutes"], msg: "Input should be greater than 0", type: "greater_than" },
      { loc: ["body", "mode"], msg: "Field required", type: "missing" },
    ],
  };
  assert.equal(detailOf(unprocessable, "Unprocessable"), "Input should be greater than 0; Field required");
  assert.equal(detailOf({ detail: { message: "An interview is open." } }, "Conflict"), "An interview is open.");
  assert.equal(detailOf({ error: { code: "x" } }, "Bad Request"), "Bad Request");
  assert.equal(detailOf(null, "Bad Gateway"), "Bad Gateway");
});

console.log(`\n${passed} passed`);
