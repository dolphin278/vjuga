/**
 * Formats fuzz: IP predicates against node:net, grammar-generated emails and
 * URIs (always accepted) and their single-character corruptions (always
 * rejected), and arbitrary strings never throwing.
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { isIPv4 as netIsIPv4, isIPv6 as netIsIPv6 } from "node:net";
import {
  KNOWN_FORMATS,
  formatTester,
  isEmail,
  isIPv4,
  isIPv6,
  isUri,
  isUuid,
} from "../../../schema/Formats.js";
import * as Arb from "../../../Arbitrary.js";
import * as Prop from "../../../Property.js";
import { rng, type Rng } from "./_serial-gen.js";

const NUM_RUNS = 1_000_000;

const int = (r: Rng, n: number): number => Math.floor(r() * n);
const pickOf = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, xs.length)];
const repeat = (r: Rng, min: number, max: number, f: () => string, sep = ""): string =>
  Array.from({ length: min + int(r, max - min + 1) }, f).join(sep);
const chars = (r: Rng, alphabet: string, min: number, max: number): string =>
  repeat(r, min, max, () => alphabet[int(r, alphabet.length)]);

const seeds = Arb.integer(0, 0x7fffffff);

// ---------------------------------------------------------------------------
// IP addresses vs node:net
// ---------------------------------------------------------------------------

function octet(r: Rng): string {
  switch (int(r, 6)) {
    case 0:
      return "0" + int(r, 300); // leading zero
    case 1:
      return String(250 + int(r, 10)); // around the 255 edge
    default:
      return String(int(r, 300));
  }
}

function ipv4ish(r: Rng): string {
  const parts = Array.from({ length: 3 + int(r, 3) }, () => octet(r));
  return parts.join(int(r, 20) === 0 ? ".." : ".");
}

function ipv6ish(r: Rng): string {
  const groups = Array.from({ length: 1 + int(r, 9) }, () =>
    chars(r, "0123456789abcdefABCDEF", 1, int(r, 8) === 0 ? 5 : 4),
  );
  let s = groups.join(":");
  if (int(r, 2) === 0) {
    // compress somewhere (possibly twice)
    const at = int(r, groups.length + 1);
    s = groups.slice(0, at).join(":") + "::" + groups.slice(at).join(":");
    if (int(r, 10) === 0) s += "::1";
  }
  if (int(r, 4) === 0) s += ":" + ipv4ish(r);
  if (int(r, 15) === 0) s = s.slice(1);
  if (int(r, 15) === 0) s += ":";
  return s;
}

test("isIPv4 equals node:net isIPv4", () => {
  Prop.assert(
    seeds,
    (seed) => {
      const s = ipv4ish(rng(seed));
      assert.equal(isIPv4(s), netIsIPv4(s), s);
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

test("isIPv6 equals node:net isIPv6 (no zone ids)", () => {
  Prop.assert(
    seeds,
    (seed) => {
      const s = ipv6ish(rng(seed));
      assert.equal(isIPv6(s), netIsIPv6(s), s);
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// email / uri: grammar-generated values pass, corrupted ones fail
// ---------------------------------------------------------------------------

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ATEXT = ALNUM + "!#$%&'*+/=?^_`{|}~-";

function label(r: Rng): string {
  const n = 1 + int(r, 12);
  if (n === 1) return chars(r, ALNUM, 1, 1);
  return chars(r, ALNUM, 1, 1) + chars(r, ALNUM + "-", n - 2, n - 2) + chars(r, ALNUM, 1, 1);
}

const domain = (r: Rng): string => repeat(r, 1, 4, () => label(r), ".");
const v4 = (r: Rng): string => Array.from({ length: 4 }, () => String(int(r, 256))).join(".");
const v6 = (r: Rng): string =>
  int(r, 2) === 0
    ? Array.from({ length: 8 }, () => int(r, 0x10000).toString(16)).join(":")
    : int(r, 0x10000).toString(16) + "::" + int(r, 0x10000).toString(16);

function validEmail(r: Rng): string {
  const local =
    int(r, 3) === 0
      ? '"' +
        repeat(r, 0, 6, () =>
          int(r, 4) === 0
            ? "\\" + String.fromCharCode(0x20 + int(r, 0x5f))
            : pickOf(r, [" ", "a", "@", ".", "(", ",", "~"]),
        ) +
        '"'
      : repeat(r, 1, 3, () => chars(r, ATEXT, 1, 5), ".");
  const dom =
    int(r, 6) === 0 ? "[" + v4(r) + "]" : int(r, 6) === 0 ? "[IPv6:" + v6(r) + "]" : domain(r);
  return local + "@" + dom;
}

const UNRESERVED = ALNUM + "-._~";
const SUB_DELIMS = "!$&'()*+,;=";
const PCHAR = UNRESERVED + SUB_DELIMS + ":@";
const pct = (r: Rng): string => "%" + chars(r, "0123456789abcdefABCDEF", 2, 2);
const run = (r: Rng, alphabet: string, max: number): string =>
  repeat(r, 0, max, () => (int(r, 8) === 0 ? pct(r) : chars(r, alphabet, 1, 1)));

function validUri(r: Rng): string {
  const scheme = chars(r, "abcxyzABC", 1, 1) + chars(r, ALNUM + "+-.", 0, 5);
  let rest: string;
  if (int(r, 2) === 0) {
    const user = int(r, 3) === 0 ? run(r, UNRESERVED + SUB_DELIMS + ":", 5) + "@" : "";
    const host =
      int(r, 5) === 0
        ? "[" + v6(r) + "]"
        : int(r, 5) === 0
          ? v4(r)
          : run(r, UNRESERVED + SUB_DELIMS, 8);
    const port = int(r, 3) === 0 ? ":" + chars(r, "0123456789", 0, 5) : "";
    rest = "//" + user + host + port + repeat(r, 0, 3, () => "/" + run(r, PCHAR, 5));
  } else {
    // path-rootless / path-absolute (never "//") / empty
    const first = run(r, PCHAR, 5);
    rest = (int(r, 2) === 0 && first !== "" ? "/" : "") + first;
    if (first !== "") rest += repeat(r, 0, 3, () => "/" + run(r, PCHAR, 5));
  }
  if (int(r, 3) === 0) rest += "?" + run(r, PCHAR + "/?", 6);
  if (int(r, 3) === 0) rest += "#" + run(r, PCHAR + "/?", 6);
  return scheme + ":" + rest;
}

/** Characters no email or URI may contain anywhere. */
const FORBIDDEN = [" ", "\n", "\t", "<", ">", "{", "}", "|", "^", "`", "\u007f", "é", " ", " "];

function corrupt(r: Rng, s: string): string {
  const at = int(r, s.length + 1);
  return s.slice(0, at) + pickOf(r, FORBIDDEN) + s.slice(at);
}

test("isEmail accepts grammar-generated addresses", () => {
  Prop.assert(
    seeds,
    (seed) => {
      const s = validEmail(rng(seed));
      assert.equal(isEmail(s), true, s);
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

test("isUri accepts grammar-generated URIs", () => {
  Prop.assert(
    seeds,
    (seed) => {
      const s = validUri(rng(seed));
      assert.equal(isUri(s), true, s);
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

test("a forbidden character anywhere fails email and uri (outside quoted email text)", () => {
  Prop.assert(
    seeds,
    (seed) => {
      const r = rng(seed);
      const u = corrupt(r, validUri(r));
      assert.equal(isUri(u), false, u);
      const e = validEmail(r);
      // A space is legal inside a quoted local part; corrupt only the domain
      const at = e.lastIndexOf("@");
      const bad = e.slice(0, at + 1) + corrupt(r, e.slice(at + 1));
      assert.equal(isEmail(bad), false, bad);
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Totality
// ---------------------------------------------------------------------------

test("every tester is total on arbitrary strings and matches its predicate", () => {
  const preds: Readonly<Record<string, (s: string) => boolean>> = {
    email: isEmail,
    uri: isUri,
    uuid: isUuid,
    ipv4: isIPv4,
    ipv6: isIPv6,
  };
  Prop.assert(
    Arb.string({ maxLength: 40 }),
    (s) => {
      for (const f of KNOWN_FORMATS) {
        const got = formatTester(f)!.test(s);
        if (typeof got !== "boolean") return false;
        if (Object.hasOwn(preds, f) && preds[f](s) !== got) return false;
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});
