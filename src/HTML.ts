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

/* c8 ignore next -- Node-only fallback; Bun takes Bun.escapeHTML path */
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

/* c8 ignore next 5 -- Bun path is exercised by `npm run test:bun`; Node tests always take _escapeImpl. */
export const escape: (str: string) => string =
  typeof Bun !== "undefined" && typeof Bun.escapeHTML === "function"
    ? (str) => (Bun.escapeHTML(str) as string).replaceAll("&#x27;", "&#039;")
    : _escapeImpl;
