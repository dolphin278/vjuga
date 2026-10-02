/**
 * Formats — string `format` checks enforced by `schema/Validate`.
 *
 * One table of JSON Schema 2020-12 format names and their testers, shared by
 * `Validate` (what it enforces), `Schema.fromJsonSchema` (`formats: "strict"`
 * rejects every other name) and the `StringConstraints.format` type.
 *
 * When to use: checking a single string outside a compiled validator, or
 * asking whether a format name is enforced (`isKnownFormat`).
 *
 * Grammar: `date`, `date-time` and `time` are RFC 3339 (`isISODate`,
 * `isRfc3339DateTime`, `isRfc3339Time` — not reimplemented here). `email` is
 * an RFC 5321 ASCII mailbox: dot-atom or quoted local part, hostname or
 * `[IPv4]` / `[IPv6:...]` domain. `uri` is an absolute RFC 3986 URI (any
 * scheme, ASCII only, valid `%XX`). `ipv4` is dotted decimal without leading
 * zeros, `ipv6` is RFC 4291 text form. `iso-datetime` is a legacy vjuga name:
 * a loose prefix check (`YYYY-MM-DDTHH:MM:SS…`), not RFC 3339.
 *
 * Design tradeoffs: every tester is a linear scan or an unambiguous regex, so
 * hostile input cannot trigger regex backtracking blowups. A tester is any
 * `{ test(s) }` — a `RegExp` or a wrapped predicate — so compiled validators
 * emit one call shape for all formats.
 *
 * Prior art: JSON-Schema-Test-Suite `optional/format`; RFC 3339, 3986, 4291,
 * 5321.
 *
 * @example
 * ```ts
 * import { isEmail, isUri, isKnownFormat, formatTester } from "@dolphin278/vjuga/schema/Formats";
 * isEmail('"joe bloggs"@example.com'); // true
 * isUri("mailto:joe@example.com");     // true
 * isKnownFormat("date");               // true
 * formatTester("ipv4")?.test("10.0.0.256"); // false
 * ```
 */

import { isISODate } from "../ISODate.js";
import { isRfc3339DateTime, isRfc3339Time } from "../ISOTimestamp.js";

/** Every `format` name `Validate` enforces. */
export type FormatName =
  | "date-time"
  | "date"
  | "time"
  | "email"
  | "uri"
  | "uuid"
  | "ipv4"
  | "ipv6"
  | "iso-datetime";

/** Anything with a `test(string)` method — a `RegExp` or a wrapped predicate. */
export interface FormatTester {
  test(value: string): boolean;
}

// ---------------------------------------------------------------------------
// IP addresses
// ---------------------------------------------------------------------------

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/**
 * Dotted-decimal IPv4 (`ipv4`): four octets 0–255, no leading zeros.
 *
 * @example
 * ```ts
 * isIPv4("192.168.0.1"); // true
 * isIPv4("192.168.0.01"); // false
 * ```
 */
export function isIPv4(value: string): boolean {
  return IPV4.test(value);
}

const HEX_GROUP = /^[0-9A-Fa-f]{1,4}$/;

/** Number of valid hex groups in a `:`-separated run, or -1 if any is bad. */
function hexGroups(s: string): number {
  if (s === "") return 0;
  const parts = s.split(":");
  for (let i = 0; i < parts.length; i++) {
    if (!HEX_GROUP.test(parts[i])) return -1;
  }
  return parts.length;
}

/**
 * RFC 4291 text-form IPv6 (`ipv6`): eight hex groups, one optional `::`, an
 * optional trailing dotted IPv4. No zone ids, prefixes or brackets.
 *
 * @example
 * ```ts
 * isIPv6("::ffff:192.168.0.1"); // true
 * isIPv6("1::2::3");            // false
 * ```
 */
export function isIPv6(value: string): boolean {
  let s = value;
  const lastColon = s.lastIndexOf(":");
  if (lastColon === -1) return false;
  if (s.indexOf(".", lastColon) !== -1) {
    // Embedded IPv4 counts as two groups
    if (!IPV4.test(s.slice(lastColon + 1))) return false;
    s = s.slice(0, lastColon + 1) + "0:0";
  }
  const gap = s.indexOf("::");
  if (gap === -1) return hexGroups(s) === 8;
  if (s.indexOf("::", gap + 1) !== -1) return false;
  const left = hexGroups(s.slice(0, gap));
  const right = hexGroups(s.slice(gap + 2));
  return left !== -1 && right !== -1 && left + right <= 7;
}

// ---------------------------------------------------------------------------
// email
// ---------------------------------------------------------------------------

// atext (RFC 5322 3.2.3) dot-atom, or a quoted string of qtext / quoted-pair
const ATEXT = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]";
const EMAIL_LOCAL = new RegExp(
  `^(?:${ATEXT}+(?:\\.${ATEXT}+)*|"(?:[\\x20\\x21\\x23-\\x5B\\x5D-\\x7E]|\\\\[\\x20-\\x7E])*")@`,
);
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const IPV6_TAG = /^IPv6:/i;

/** RFC 1123 host name: dot-separated labels of 1–63 chars, 253 max. */
function isDomain(s: string): boolean {
  if (s.length > 253) return false;
  const labels = s.split(".");
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l.length > 63 || !LABEL.test(l)) return false;
  }
  return true;
}

/**
 * RFC 5321 mailbox (`email`), ASCII only: `local@domain` where local is a
 * dot-atom or quoted string and domain is a host name, `[IPv4]` or
 * `[IPv6:addr]`.
 *
 * @example
 * ```ts
 * isEmail("joe.bloggs@example.com"); // true
 * isEmail("te..st@example.com");     // false
 * ```
 */
export function isEmail(value: string): boolean {
  const m = EMAIL_LOCAL.exec(value);
  if (m === null) return false;
  const domain = value.slice(m[0].length);
  if (domain.charCodeAt(0) === 0x5b /* [ */) {
    if (domain.charCodeAt(domain.length - 1) !== 0x5d /* ] */) return false;
    const lit = domain.slice(1, -1);
    return IPV6_TAG.test(lit) ? isIPv6(lit.slice(5)) : isIPv4(lit);
  }
  return isDomain(domain);
}

// ---------------------------------------------------------------------------
// uri
// ---------------------------------------------------------------------------

// Character classes of RFC 3986, as bit flags over ASCII
const UNRESERVED = 1; // ALPHA DIGIT - . _ ~
const SUB_DELIM = 2; // ! $ & ' ( ) * + , ; =
const COLON = 4;
const AT = 8;
const SLASH = 16;
const QUESTION = 32;
const HEX = 64;
const DIGIT = 128;

const CLASS = (() => {
  const t = new Uint8Array(128);
  const set = (chars: string, flag: number): void => {
    for (let i = 0; i < chars.length; i++) t[chars.charCodeAt(i)] |= flag;
  };
  const alpha = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  set(alpha + "0123456789-._~", UNRESERVED);
  set("!$&'()*+,;=", SUB_DELIM);
  set(":", COLON);
  set("@", AT);
  set("/", SLASH);
  set("?", QUESTION);
  set("0123456789abcdefABCDEF", HEX);
  set("0123456789", DIGIT);
  return t;
})();

const PCHAR = UNRESERVED | SUB_DELIM | COLON | AT;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const IPV_FUTURE = /^v[0-9A-Fa-f]+\.[A-Za-z0-9\-._~!$&'()*+,;=:]+$/;

/** True if `s[start, end)` is only chars in `mask` or `%XX` escapes. */
function scan(s: string, start: number, end: number, mask: number): boolean {
  for (let i = start; i < end; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x25 /* % */) {
      if (i + 2 >= end || !isHex(s, i + 1) || !isHex(s, i + 2)) return false;
      i += 2;
    } else if (c >= 128 || (CLASS[c] & mask) === 0) {
      return false;
    }
  }
  return true;
}

function isHex(s: string, i: number): boolean {
  const c = s.charCodeAt(i);
  return c < 128 && (CLASS[c] & HEX) !== 0;
}

/** RFC 3986 authority: `[userinfo@]host[:port]`. */
function isAuthority(s: string, start: number, end: number): boolean {
  const at = s.lastIndexOf("@", end - 1);
  let hostStart = start;
  if (at >= start) {
    if (!scan(s, start, at, UNRESERVED | SUB_DELIM | COLON)) return false;
    hostStart = at + 1;
  }
  let hostEnd: number;
  if (s.charCodeAt(hostStart) === 0x5b /* [ */) {
    const close = s.indexOf("]", hostStart);
    if (close === -1 || close >= end) return false;
    const lit = s.slice(hostStart + 1, close);
    if (!isIPv6(lit) && !IPV_FUTURE.test(lit)) return false;
    hostEnd = close + 1;
    if (hostEnd !== end && s.charCodeAt(hostEnd) !== 0x3a /* : */) return false;
  } else {
    const colon = s.indexOf(":", hostStart);
    hostEnd = colon === -1 || colon >= end ? end : colon;
    if (!scan(s, hostStart, hostEnd, UNRESERVED | SUB_DELIM)) return false;
  }
  // port = *DIGIT after the ':'
  for (let i = hostEnd + 1; i < end; i++) {
    const c = s.charCodeAt(i);
    if (c >= 128 || (CLASS[c] & DIGIT) === 0) return false;
  }
  return true;
}

/**
 * Absolute RFC 3986 URI (`uri`): `scheme:hier-part[?query][#fragment]`, any
 * scheme, ASCII only, well-formed `%XX` escapes. Relative references fail.
 *
 * @example
 * ```ts
 * isUri("https://example.com/a?b#c"); // true
 * isUri("urn:isbn:0451450523");       // true
 * isUri("/relative/path");            // false
 * ```
 */
export function isUri(value: string): boolean {
  const m = SCHEME.exec(value);
  if (m === null) return false;
  const len = value.length;
  const hash = value.indexOf("#");
  const end = hash === -1 ? len : hash;
  if (hash !== -1 && !scan(value, hash + 1, len, PCHAR | SLASH | QUESTION)) return false;
  const q = value.indexOf("?");
  const pathEnd = q === -1 || q > end ? end : q;
  if (pathEnd !== end && !scan(value, pathEnd + 1, end, PCHAR | SLASH | QUESTION)) return false;
  let pathStart = m[0].length;
  if (value.startsWith("//", pathStart)) {
    const authStart = pathStart + 2;
    const slash = value.indexOf("/", authStart);
    const authEnd = slash === -1 || slash > pathEnd ? pathEnd : slash;
    if (!isAuthority(value, authStart, authEnd)) return false;
    pathStart = authEnd;
  }
  return scan(value, pathStart, pathEnd, PCHAR | SLASH);
}

// ---------------------------------------------------------------------------
// uuid, legacy iso-datetime
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RFC 4122 text form (`uuid`): 8-4-4-4-12 hex digits, any case, any version.
 *
 * @example
 * ```ts
 * isUuid("2EB8AA08-AA98-11EA-B4AA-73B441D16380"); // true
 * ```
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const FORMATS: Readonly<Record<FormatName, FormatTester>> = {
  "date-time": { test: isRfc3339DateTime },
  date: { test: isISODate },
  time: { test: isRfc3339Time },
  email: { test: isEmail },
  uri: { test: isUri },
  uuid: UUID,
  ipv4: IPV4,
  ipv6: { test: isIPv6 },
  // Legacy vjuga name: prefix-only, kept byte-for-byte for compatibility
  "iso-datetime": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
};

/** Every enforced format name, in declaration order. */
export const KNOWN_FORMATS: readonly FormatName[] = Object.keys(FORMATS) as FormatName[];

/**
 * True if `Validate` enforces `name`. Own-key lookup, so `"constructor"` and
 * other `Object.prototype` names are never known.
 *
 * @example
 * ```ts
 * isKnownFormat("date-time"); // true
 * isKnownFormat("hostname");  // false (annotation-only)
 * ```
 */
export function isKnownFormat(name: string): name is FormatName {
  return Object.hasOwn(FORMATS, name);
}

/**
 * The tester for `name`, or `undefined` for a name that is annotation-only.
 *
 * @example
 * ```ts
 * formatTester("date")?.test("2024-02-30"); // false
 * formatTester("hostname");                 // undefined
 * ```
 */
export function formatTester(name: string): FormatTester | undefined {
  return isKnownFormat(name) ? FORMATS[name] : undefined;
}
