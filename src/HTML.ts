const [
  GT_CHAR_CODE,
  LT_CHAR_CODE,
  AMP_CHAR_CODE,
  QUOTE_CHAR_CODE,
  APOS_CHAR_CODE,
] = [">", "<", "&", '"', "'"].map((x) => x.charCodeAt(0));

const GT_STR = "&gt;";
const LT_STR = "&lt;";
const AMP_STR = "&amp;";
const QUOTE_STR = "&quot;";
const APOS_STR = "&#039;";

// Escape HTML string
export function escape(str: string) {
  var char;
  var right;
  var left = 0;
  var result = "";
  var escapedAtLeastOnce = false;
  if (str.length === 0) {
    return str;
  }
  for (right = left; right < str.length; right++) {
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
}
