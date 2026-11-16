import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as Text from "../Text.js";

/** The definition `isNonBlank` implements, as a regex. */
const TRIMMED = /^\S(?:[\s\S]*\S)?$/;

/** Every code unit `\s` matches (all are in the BMP). */
const SPACES: number[] = [];
for (let c = 0; c <= 0xffff; c++) if (/\s/.test(String.fromCharCode(c))) SPACES.push(c);

test("the whitespace set is what \\s and trim() use", () => {
  assert.deepEqual(
    SPACES,
    [
      9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201,
      8202, 8232, 8233, 8239, 8287, 12288, 65279,
    ],
  );
  for (let c = 0; c <= 0xffff; c++) {
    const ch = String.fromCharCode(c);
    const space = SPACES.includes(c);
    assert.equal(ch.trim() === "", space, `trim U+${c.toString(16)}`);
    assert.equal(Text.isNonBlank(ch), !space, `isNonBlank U+${c.toString(16)}`);
    assert.equal(Text.isNonBlank(`a${ch}`), !space);
    assert.equal(Text.isNonBlank(`${ch}a`), !space);
    assert.equal(Text.isNonBlank(`a${ch}a`), true);
  }
});

test("isNonBlank checks, never trims; lone surrogates count as non-space", () => {
  for (const s of ["a", "a b", "a\nb", "\ud800", "x\udfff", "😀"]) {
    assert.equal(Text.isNonBlank(s), true, JSON.stringify(s));
    assert.equal(TRIMMED.test(s), true);
  }
  for (const s of ["", " ", " a", "a ", "\ta", "a　", "﻿a"]) {
    assert.equal(Text.isNonBlank(s), false, JSON.stringify(s));
  }
  for (const v of [1, null, undefined, {}, ["a"]]) assert.equal(Text.isNonBlank(v), false);
});

test("nonBlank / nonBlankExn trim, then check", () => {
  assert.deepEqual(Text.nonBlank("  The bridge reopens. "), [true, "The bridge reopens."]);
  assert.deepEqual(Text.nonBlank("ok"), [true, "ok"]);
  assert.deepEqual(Text.nonBlank(" a "), [true, "a"]);
  assert.deepEqual(Text.nonBlank("   "), [false, "blank"]);
  assert.deepEqual(Text.nonBlank(""), [false, "blank"]);
  assert.equal(Text.nonBlankExn("x"), "x");
  assert.equal(Text.nonBlankExn("  title "), "title");
  assert.throws(() => Text.nonBlankExn(" \n "), {
    name: "RangeError",
    cause: "blank",
    message: 'Expected NonBlank (blank), got " \\n "',
  });
});

test("assertNonBlank: TypeError, or RangeError naming blank / untrimmed", () => {
  assert.throws(() => Text.assertNonBlank(5), TypeError);
  assert.throws(() => Text.assertNonBlank(""), { name: "RangeError", cause: "blank" });
  assert.throws(() => Text.assertNonBlank(" a"), { name: "RangeError", cause: "untrimmed" });
  assert.throws(() => Text.assertNonBlank("   "), { cause: "blank" });
  const v: unknown = "a";
  Text.assertNonBlank(v);
  const nb: Text.NonBlank = v;
  const ne: Text.NonEmptyString = nb; // a NonBlank is a NonEmptyString
  const s: string = ne;
  assert.equal(s, "a");
});

test("NonEmptyString standard set", () => {
  assert.equal(Text.isNonEmptyString(" "), true);
  assert.equal(Text.isNonEmptyString(""), false);
  assert.equal(Text.isNonEmptyString(0), false);
  assert.deepEqual(Text.nonEmptyString(" "), [true, " "]);
  assert.deepEqual(Text.nonEmptyString(""), [false, "empty"]);
  assert.equal(Text.nonEmptyStringExn("a"), "a");
  assert.throws(() => Text.nonEmptyStringExn(""), { name: "RangeError", cause: "empty" });
  assert.throws(() => Text.assertNonEmptyString(""), { name: "RangeError", cause: "empty" });
  assert.throws(() => Text.assertNonEmptyString(null), TypeError);
  const v: unknown = "x";
  Text.assertNonEmptyString(v);
  const ne: Text.NonEmptyString = v;
  // @ts-expect-error a NonEmptyString is not a NonBlank
  const nb: Text.NonBlank = ne;
  // @ts-expect-error a plain string is not a NonEmptyString
  const bad: Text.NonEmptyString = "y" as string;
  assert.equal(nb + bad, "xy");
});
