// Bun takes the Bun.escapeHTML fast path; Node and scriptc run _escapeImpl.
import { bench } from "./harness.js";
import { escape } from "../../src/HTML.js";

const special = `<a href="x">Tom & 'Jerry'</a>`;
const plain = "The quick brown fox jumps over the lazy dog. ".repeat(4);

bench("escape (30 chars, 8 specials)", (i) => escape(special).length + (i & 1));
bench("escape (180 chars, none)", (i) => escape(plain).length + (i & 1));
