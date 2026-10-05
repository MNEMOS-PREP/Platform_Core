/**
 * The interviewer's voice, chosen and spoken (src/voice/core.ts), pinned.
 *
 *   npm test        (Node 22+ runs TypeScript directly)
 *
 * The voice lists below are what the browsers actually report: Edge's online
 * neural voices, Windows' own (which Chrome lists too), Chrome's Google voices.
 */
import assert from "node:assert/strict";

import {
  kindOf,
  parseVoiceId,
  pickVoice,
  rateFor,
  sentencesOf,
  speakable,
  splitSentences,
  type VoiceLike,
} from "../src/voice/core.ts";

const v = (name: string, lang: string, localService = false): VoiceLike => ({ name, lang, localService });

const EDGE = [
  v("Microsoft Neerja Online (Natural) - English (India)", "en-IN"),
  v("Microsoft Prabhat Online (Natural) - English (India)", "en-IN"),
  v("Microsoft Aria Online (Natural) - English (United States)", "en-US"),
  v("Microsoft Heera - English (India)", "en-IN", true),
  v("Microsoft Ravi - English (India)", "en-IN", true),
  v("Microsoft स्वरा Online (Natural) - Hindi (India)", "hi-IN"),
];
const CHROME_WINDOWS = [
  v("Microsoft Ravi - English (India)", "en-IN", true),
  v("Microsoft David - English (United States)", "en-US", true),
  v("Google US English", "en-US"),
  v("Google UK English Female", "en-GB"),
  v("Google UK English Male", "en-GB"),
];

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("a persona's voice_id is read, and a malformed one falls back to Indian English", () => {
  assert.deepEqual(parseVoiceId("en-IN-female-warm"), { locale: "en-IN", kind: "female", manner: "warm" });
  assert.deepEqual(parseVoiceId("a nice voice"), { locale: "en-IN", kind: "", manner: "neutral" });
  assert.deepEqual(parseVoiceId(undefined).locale, "en-IN");
});

test("in Edge each persona gets the neural Indian-English voice of their kind", () => {
  assert.match(pickVoice(EDGE, parseVoiceId("en-IN-female-warm"))!.name, /Neerja/);
  assert.match(pickVoice(EDGE, parseVoiceId("en-IN-male-brisk"))!.name, /Prabhat/);
});

test("the Hindi voice is never chosen to read English", () => {
  const hindiOnly = [v("Microsoft स्वरा Online (Natural) - Hindi (India)", "hi-IN")];
  assert.equal(pickVoice(hindiOnly, parseVoiceId("en-IN-female-neutral")), null);
});

test("without a neural voice the Windows Indian-English voices are used", () => {
  const local = EDGE.filter((voice) => voice.localService);
  assert.match(pickVoice(local, parseVoiceId("en-IN-female-neutral"))!.name, /Heera/);
  assert.match(pickVoice(local, parseVoiceId("en-IN-male-measured"))!.name, /Ravi/);
});

test("in Chrome a woman's persona keeps a woman's voice over an Indian accent", () => {
  // No female en-IN voice in this list: Priya reads as Priya in a British
  // woman's voice, and would not in an Indian man's.
  assert.match(pickVoice(CHROME_WINDOWS, parseVoiceId("en-IN-female-neutral"))!.name, /UK English Female/);
  assert.match(pickVoice(CHROME_WINDOWS, parseVoiceId("en-IN-male-casual"))!.name, /Ravi/);
});

test("a voice's kind comes from its name or the known-voices table, else nothing", () => {
  assert.equal(kindOf(v("Google UK English Male", "en-GB")), "male");
  assert.equal(kindOf(v("Microsoft Neerja Online (Natural) - English (India)", "en-IN")), "female");
  assert.equal(kindOf(v("Some New Voice", "en-IN")), null);
});

test("the choice is the same on every load", () => {
  const shuffled = [...EDGE].reverse();
  assert.equal(
    pickVoice(shuffled, parseVoiceId("en-IN-male-neutral"))!.name,
    pickVoice(EDGE, parseVoiceId("en-IN-male-neutral"))!.name,
  );
});

test("manner is pace: brisk is quicker than measured, and unknown is normal", () => {
  assert.ok(rateFor("brisk") > rateFor("neutral"));
  assert.ok(rateFor("measured") < rateFor("neutral"));
  assert.equal(rateFor("operatic"), 1);
});

test("code and links are on screen, not read out", () => {
  const said = speakable("Here is the stub:\n```python\ndef f(x):\n    return x\n```\nSee https://example.com/q1 first.");
  assert.ok(!said.includes("def f"), said);
  assert.match(said, /code is on your screen/);
  assert.match(said, /link on your screen/);
});

test("complexity, languages and abbreviations are said the way people say them", () => {
  assert.equal(speakable("Can you do it in O(n log n)?"), "Can you do it in O of n log n?");
  assert.match(speakable("Is O(n^2) acceptable?"), /O of n squared/);
  assert.match(speakable("Have you used C++ or C#?"), /C plus plus or C sharp/);
  assert.match(speakable("A hash map, e.g. a dict"), /for example/);
  assert.equal(speakable("Use the `HashMap` class"), "Use the HashMap class");
});

test("long text is split into sentences short enough to speak whole", () => {
  const long = `${"word ".repeat(120)}end. Next one?`;
  const parts = splitSentences(long, 220);
  assert.ok(parts.length >= 3, String(parts.length));
  assert.ok(parts.every((p) => p.length <= 220));
  assert.equal(parts.at(-1), "Next one?");
  assert.deepEqual(splitSentences("Tell me about yourself. Take your time."), [
    "Tell me about yourself.",
    "Take your time.",
  ]);
  // A title's full stop is not the end of a sentence.
  assert.deepEqual(splitSentences("Okay. Dr. Raghavan, over to you."), ["Okay.", "Dr. Raghavan, over to you."]);
  assert.equal(speakable("Dr. Raghavan, over to you."), "Doctor Raghavan, over to you.");
});

test("a panel's line is said part by part, each sentence by its own speaker", () => {
  const room = { personaId: "methodical_engineer", voiceId: "en-IN-female-neutral" };
  const { line, sentences } = sentencesOf(
    [
      { text: "Okay, let's leave that there. Dr. Raghavan, over to you.", id: "t1:0" },
      {
        text: "Thanks, Priya. Walk me through the classifier.",
        personaId: "professor",
        voiceId: "en-IN-male-measured",
        id: "t1:1",
      },
    ],
    room,
  );
  assert.equal(
    line,
    "Okay, let's leave that there. Doctor Raghavan, over to you. Thanks, Priya. Walk me through the classifier.",
  );
  assert.deepEqual(
    sentences.map((s) => [s.personaId, s.partId]),
    [
      ["methodical_engineer", "t1:0"],
      ["methodical_engineer", "t1:0"],
      ["professor", "t1:1"],
      ["professor", "t1:1"],
    ],
  );
  assert.equal(sentences[2]!.voiceId, "en-IN-male-measured");
  // A plain string is one part, said by the room's own interviewer.
  const plain = sentencesOf("Next question. What is a heap?", room);
  assert.deepEqual(
    plain.sentences.map((s) => s.personaId),
    ["methodical_engineer", "methodical_engineer"],
  );
  assert.equal(plain.sentences[0]!.partId, null);
  // Nothing to say is skipped, not an empty sentence.
  assert.deepEqual(
    sentencesOf([{ text: "  " }, { text: "Hi." }], room).sentences.map((s) => s.text),
    ["Hi."],
  );
});

console.log(`\n${passed} passed`);
