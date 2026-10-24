/**
 * HTML — HTML entity escaping for safe interpolation into markup.
 *
 * Escapes the five XML-significant characters (`& < > " '`) using a charCode
 * switch over the input string. A left/right cursor tracks the last escape
 * point so unescaped runs are copied via a single `str.slice()` rather than
 * character-by-character concatenation — this avoids intermediate string
 * allocations on inputs with few escape points.
 *
 * When to use: any time you interpolate user-controlled content into HTML.
 * Do NOT use this for JSON embedded in `<script>` tags, and
 * `JSON.stringify` alone is not safe there either (`</script>` and `<!--` in a
 * string value break out of the element). Escape `<` as `\u003c` (and
 * `U+2028`/`U+2029`) in the serialized JSON, or use a data attribute.
 *
 * Design tradeoffs:
 *   - charCode switch vs `String.prototype.replace(/[&<>"']/g, fn)` in Node
 *     (see `src/benchmarks/HTML.bench.ts`): 2-3x faster on strings with
 *     escapes (few: 89 vs 268 ns, many: 195 vs 623 ns, long: 7.3 vs 14.9 us),
 *     but only on par on short clean strings (57 vs 51 ns), where the regex
 *     scan wins slightly.
 *   - On Bun, delegates to the native `Bun.escapeHTML` (C++ SIMD path) with a
 *     post-processing `replaceAll("&#x27;", "&#039;")` to normalize the single-
 *     quote encoding to match the Node fallback output.
 *
 * Prior art: OWASP XSS Prevention Cheat Sheet (the five characters).
 *
 * @example
 * ```ts
 * import * as HTML from "@dolphin278/vjuga/HTML";
 * HTML.escape('<script>alert("xss")</script>');
 * // "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
 * ```
 */

// Literal constants, not `[">", ...].map((x) => x.charCodeAt(0))`
// destructuring: those elements are `number | undefined`, and scriptc 0.4.4
// refuses a `switch` case whose type differs from the discriminant (SC1090,
// missing lowering, no issue).
const GT_CHAR_CODE = 62; // ">"
const LT_CHAR_CODE = 60; // "<"
const AMP_CHAR_CODE = 38; // "&"
const QUOTE_CHAR_CODE = 34; // '"'
const APOS_CHAR_CODE = 39; // "'"

const GT_STR = "&gt;";
const LT_STR = "&lt;";
const AMP_STR = "&amp;";
const QUOTE_STR = "&quot;";
const APOS_STR = "&#039;";

// Node-only fallback; Bun takes Bun.escapeHTML path
/* node:coverage ignore next */
const _escapeImpl = (str: string): string => {
  let char: string | undefined;
  let left = 0;
  let result = "";
  let escapedAtLeastOnce = false;
  if (str.length === 0) {
    return str;
  }
  for (let right = 0; right < str.length; right++) {
    switch (str.charCodeAt(right)) {
      case GT_CHAR_CODE:
        char = GT_STR;
        break;
      case LT_CHAR_CODE:
        char = LT_STR;
        break;
      case AMP_CHAR_CODE:
        char = AMP_STR;
        break;
      case QUOTE_CHAR_CODE:
        char = QUOTE_STR;
        break;
      case APOS_CHAR_CODE:
        char = APOS_STR;
        break;
      default:
        continue;
    }
    if (left !== right) {
      result += str.slice(left, right);
    }
    result += char;
    escapedAtLeastOnce = true;
    left = right + 1;
  }

  if (!escapedAtLeastOnce) {
    return str;
  }
  if (left < str.length) {
    result += str.slice(left);
  }
  return result;
};

// Read through globalThis, not `typeof Bun` on a `declare const`: scriptc 0.4.4
// lowers that `typeof` to a ReferenceError when Bun is absent. Remove once
// https://github.com/vercel-labs/scriptc/issues/2134 is fixed.
const bun = (globalThis as { Bun?: { escapeHTML?: (str: string) => string | Uint8Array } }).Bun;

// Bun path is exercised by `npm run test:bun`; Node tests always take _escapeImpl.
/* node:coverage ignore next 5 */
const bunEscape = bun?.escapeHTML;
export const escape: (str: string) => string =
  typeof bunEscape === "function"
    ? (str) => (bunEscape(str) as string).replaceAll("&#x27;", "&#039;")
    : _escapeImpl;
