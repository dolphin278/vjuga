import { escape } from "../../src/HTML.js";
console.log(escape(`<a href="x">Tom & 'Jerry'</a>`));
console.log(escape("plain"));
