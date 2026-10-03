import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KNOWN_FORMATS,
  formatTester,
  isEmail,
  isIPv4,
  isIPv6,
  isKnownFormat,
  isUri,
  isUuid,
} from "../../schema/Formats.js";

// ---------------------------------------------------------------------------
// JSON-Schema-Test-Suite optional/format (pinned, see fixtures README)
// ---------------------------------------------------------------------------

interface Group {
  readonly description: string;
  readonly tests: readonly { description: string; data: unknown; valid: boolean }[];
}

const SUITE: Readonly<Record<string, URL>> = {
  email: new URL("./fixtures/json-schema-test-suite/optional/format/email.json", import.meta.url),
  uri: new URL("./fixtures/json-schema-test-suite/optional/format/uri.json", import.meta.url),
  uuid: new URL("./fixtures/json-schema-test-suite/optional/format/uuid.json", import.meta.url),
  ipv4: new URL("./fixtures/json-schema-test-suite/optional/format/ipv4.json", import.meta.url),
  ipv6: new URL("./fixtures/json-schema-test-suite/optional/format/ipv6.json", import.meta.url),
  // date / date-time / time are vendored once, next to the ISODate tests
  date: new URL("../fixtures/json-schema-test-suite/date.json", import.meta.url),
  "date-time": new URL("../fixtures/json-schema-test-suite/date-time.json", import.meta.url),
  time: new URL("../fixtures/json-schema-test-suite/time.json", import.meta.url),
};

for (const name of Object.keys(SUITE)) {
  test(`JSON-Schema-Test-Suite format ${name}: every string case agrees`, () => {
    const tester = formatTester(name);
    assert.ok(tester !== undefined);
    const groups = JSON.parse(readFileSync(SUITE[name], "utf8")) as Group[];
    let n = 0;
    for (const g of groups) {
      for (const t of g.tests) {
        if (typeof t.data !== "string") continue;
        n++;
        assert.equal(
          tester.test(t.data),
          t.valid,
          `${name}: ${t.description} ${JSON.stringify(t.data)}`,
        );
      }
    }
    assert.ok(n > 10);
  });
}

test("every enforced format except the legacy iso-datetime has a suite file", () => {
  assert.deepEqual(
    new Set(KNOWN_FORMATS.filter((f) => f !== "iso-datetime")),
    new Set(Object.keys(SUITE)),
  );
});

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

test("isKnownFormat / formatTester — own keys only", () => {
  for (const f of KNOWN_FORMATS) {
    assert.equal(isKnownFormat(f), true);
    assert.equal(typeof formatTester(f)?.test, "function");
  }
  for (const f of ["hostname", "constructor", "__proto__", "toString", "", "DATE"]) {
    assert.equal(isKnownFormat(f), false, f);
    assert.equal(formatTester(f), undefined, f);
  }
});

test("iso-datetime keeps its legacy loose prefix semantics", () => {
  const t = formatTester("iso-datetime")!;
  assert.equal(t.test("2024-01-15T10:30:00Z"), true);
  assert.equal(t.test("2024-99-99T99:99:99 trailing junk"), true); // prefix only
  assert.equal(t.test("2024-01-15T10:30"), false);
  assert.equal(t.test("2024-01-15"), false);
});

// ---------------------------------------------------------------------------
// Predicates — branches the suite does not reach
// ---------------------------------------------------------------------------

test("isIPv4 / isIPv6", () => {
  assert.equal(isIPv4("0.0.0.0"), true);
  assert.equal(isIPv4("01.0.0.0"), false);
  assert.equal(isIPv6("::"), true);
  assert.equal(isIPv6("1:2:3:4:5:6:7::"), true);
  assert.equal(isIPv6("1:2:3:4:5:6:7:8:9"), false);
  assert.equal(isIPv6("1:2:3:4:5:6:7:8::"), false);
  assert.equal(isIPv6(":::"), false);
  assert.equal(isIPv6("g::"), false);
  assert.equal(isIPv6("::g"), false);
  assert.equal(isIPv6("::1.2.3"), false);
  assert.equal(isIPv6("1.2.3.4"), false);
  assert.equal(isIPv6("::1.2.3.4"), true);
});

test("isEmail — domain literals and limits", () => {
  assert.equal(isEmail("a@[1.2.3.4]"), true);
  assert.equal(isEmail("a@[IPv6:2001:db8::1]"), true);
  assert.equal(isEmail("a@[IPv6:2001:db8::g]"), false);
  assert.equal(isEmail("a@[1.2.3.4"), false);
  assert.equal(isEmail("a@" + "b".repeat(63) + ".com"), true);
  assert.equal(isEmail("a@" + "b".repeat(64) + ".com"), false);
  assert.equal(isEmail("a@" + "b.".repeat(126) + "cc"), false); // 254 chars
  assert.equal(isEmail("a@" + "b.".repeat(125) + "cc"), true); // 252 chars
  assert.equal(isEmail("no-at-sign"), false);
  assert.equal(isEmail('"a\tb"@iana.org'), false); // control char in quoted text
  assert.equal(isEmail('"é"@iana.org'), false);
  assert.equal(isEmail('"unclosed'), false);
  assert.equal(isEmail('"a"'), false); // no @ after the quoted string
  assert.equal(isEmail("a@"), false);
  assert.equal(isEmail("a@b-"), false);
  assert.equal(isEmail("a@-b"), false);
  // RFC 5321 §4.5.3.1.1: local part at most 64 octets (quotes included)
  assert.equal(isEmail("x".repeat(64) + "@x.com"), true);
  assert.equal(isEmail("x".repeat(65) + "@x.com"), false);
  assert.equal(isEmail("a." + "x".repeat(63) + "@x.com"), false); // 65 with a dot
  assert.equal(isEmail('"' + "x".repeat(62) + '"@x.com'), true); // 64 with quotes
  assert.equal(isEmail('"' + "x".repeat(63) + '"@x.com'), false);
});

test("isUri — authority, ports, IP literals, query and fragment", () => {
  for (const ok of [
    "http://user:pw@host:8080/p?q=1#f",
    "http://host:/p", // empty port is allowed
    "http://[::1]:80/",
    "http://[v1.fe]/",
    "http://[V1.x]/", // ABNF literals are case-insensitive
    "http://[VaF.a:b]/",
    "file:///etc/hosts", // empty host
    "a:", // scheme + empty path
    "a:b/c",
    "a:/b",
    "http://h?q/?#f/?",
    "http://h#",
    "http://h/%41%62",
    // Shapes taken by the regex fast path
    "http://",
    "HTTP://H.example:/",
    "http://h/a@b:c//d",
    "http://h/p?#",
    "svn+ssh://h:22/r?a=/b?c#d/?e",
  ]) {
    assert.equal(isUri(ok), true, ok);
  }
  for (const bad of [
    "http://[::1",
    "http://[::1]x/",
    "http://[::1/]",
    "http://[zz]/",
    "http://[V.x]/",
    "http://[W1.x]/",
    "http://a@b@c/",
    "http://h:8a/",
    "http://h:8é/",
    "http://h/%4",
    "http://h/%4g",
    "http://h/é",
    "http://h?é",
    "http://h#é",
    "http://h##",
    "http://h^/",
    "http://h:80:90/",
    "http://h/p#a#b",
    "http://h/a b",
    "http://h/\n",
    "1http://h/",
    "",
    ":",
  ]) {
    assert.equal(isUri(bad), false, bad);
  }
});

test("isUuid", () => {
  assert.equal(isUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isUuid("550e8400-e29b-41d4-a716-44665544000"), false);
  // any variant nibble (UUID.uuid requires 8/9/a/b there): documented looseness
  assert.equal(isUuid("550e8400-e29b-41d4-0716-446655440000"), true);
  assert.equal(isUuid("550e8400-e29b-41d4-c716-446655440000"), true);
});

test("testers stay linear on adversarial input (no regex backtracking blowup)", () => {
  const inputs = [
    "a".repeat(100_000) + "!",
    "a.".repeat(50_000) + "@",
    '"' + "\\a".repeat(50_000),
    "a@" + "b-".repeat(50_000),
    "a@" + "b".repeat(100_000),
    "http://" + "%41".repeat(30_000) + " ",
    "http://h/" + "a/".repeat(50_000) + "<",
    ":".repeat(100_000),
    "1:".repeat(50_000),
    "0".repeat(100_000),
  ];
  const start = performance.now();
  for (const s of inputs) {
    for (const f of KNOWN_FORMATS) formatTester(f)!.test(s);
  }
  assert.ok(performance.now() - start < 2000, "format testers took too long");
});
