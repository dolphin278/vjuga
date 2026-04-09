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
 * For JSON inside `<script>` tags, `JSON.stringify` is sufficient.
 *
 * Design tradeoffs:
 *   - charCode switch is ~2× faster than `String.prototype.replace(/regex/)` in
 *     V8 because it avoids regexp compilation and match-object allocation.
 *   - On Bun, delegates to the native `Bun.escapeHTML` (C++ SIMD path) with a
 *     post-processing `replaceAll("&#x27;", "&#039;")` to normalize the single-
 *     quote encoding to match the Node fallback output.
 *
 * Prior art: OWASP XSS Prevention Cheat Sheet (the five characters).
 *
 * @example
 * ```ts
 * import * as HTML from "vjuga/HTML";
 * HTML.escape('<script>alert("xss")</script>');
 * // "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
 * ```
 */

// one-time module init, not a hot path
const [GT_CHAR_CODE, LT_CHAR_CODE, AMP_CHAR_CODE, QUOTE_CHAR_CODE, APOS_CHAR_CODE] = [
  ">",
  "<",
  "&",
  '"',
  "'",
].map((x) => x.charCodeAt(0));

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

declare const Bun: { escapeHTML: (str: string) => string | Uint8Array } | undefined;

// Bun path is exercised by `npm run test:bun`; Node tests always take _escapeImpl.
/* node:coverage ignore next 5 */
export const escape: (str: string) => string =
  typeof Bun !== "undefined" && typeof Bun.escapeHTML === "function"
    ? (str) => (Bun.escapeHTML(str) as string).replaceAll("&#x27;", "&#039;")
    : _escapeImpl;
