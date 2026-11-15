import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as Text from "../../Text.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";

/** The definition `isNonBlank` implements, as a regex (`\s` = trim's set). */
const TRIMMED = /^\S(?:[\s\S]*\S)?$/;

/** Whitespace of every kind, lone surrogates, and ordinary characters. */
const PIECES = [
  " ",
  "\t",
  "\n",
  "\r",
  "\v",
  "\f",
  " ",
  " ",
  " ",
  " ",
  "​",
  " ",
  " ",
  " ",
  " ",
  "　",
  "﻿",
  "\ud800",
  "\udfff",
  "😀",
  "a",
  "Z",
  "0",
  "-",
  "\u0085",
  "᠎",
] as const;
const textArb: Arb.Arbitrary<string> = Arb.oneOf(
  Arb.map(Arb.array(Arb.constantFrom(...PIECES), { maxLength: 6 }), (xs) => xs.join("")),
  Arb.string({ maxLength: 8 }),
);

test("isNonBlank equals the regex; nonBlank equals trim-then-check; assert/Exn agree", () => {
  Prop.assert(
    textArb,
    (s) => {
      const strict = TRIMMED.test(s);
      assert.equal(Text.isNonBlank(s), strict, JSON.stringify(s));
      const t = s.trim();
      const ok = t.length > 0;
      assert.deepEqual(Text.nonBlank(s), ok ? [true, t] : [false, "blank"]);
      if (ok) {
        assert.equal(Text.nonBlankExn(s), t);
        assert.equal(Text.isNonBlank(t), true);
      } else {
        assert.throws(() => Text.nonBlankExn(s), { name: "RangeError", cause: "blank" });
      }
      if (strict) Text.assertNonBlank(s);
      else {
        const cause = t.length === 0 ? "blank" : "untrimmed";
        assert.throws(() => Text.assertNonBlank(s), { name: "RangeError", cause });
      }
      assert.equal(Text.isNonEmptyString(s), s.length > 0);
      assert.deepEqual(Text.nonEmptyString(s), s.length > 0 ? [true, s] : [false, "empty"]);
    },
    { numRuns: 1_000_000 },
  );
});
