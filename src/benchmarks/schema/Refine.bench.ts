import { bench, run } from "mitata";
import { reportOptimizationStatus } from "../_v8.js";
import * as S from "../../schema/Schema.js";
import * as SJ from "../../schema/JSON.js";
import { validate } from "../../schema/Validate.js";
import { ok, err, type Result } from "../../Result.js";
import type { Branded } from "../../FunctionUtils.js";

// Cost of refinements: the same 5-field row as a plain schema, with type
// guards (brands, value unchanged), with identity Result constructors (brand
// constructors that return their input: no copy), and with a normalizing
// constructor (trim: the row is copied). Then one-pass JSON.parse(schema)
// against native JSON.parse + validate. Inputs rotate through a pool so V8
// cannot constant-fold.

type Id = Branded<number, "Id">;
type Name = Branded<string, "Name">;
type Email = Branded<string, "Email">;
type Tag = Branded<string, "Tag">;

const isId = (n: number): n is Id => n >= 0;
const isName = (s: string): s is Name => s.length > 0;
const isEmail = (s: string): s is Email => s.indexOf("@") > 0;
const asEmail = (s: string): Result<Email, "bad-email"> =>
  s.indexOf("@") > 0 ? ok(s as Email) : err("bad-email");
const asTag = (s: string): Result<Tag, "blank"> => (s.length > 0 ? ok(s as Tag) : err("blank"));
const trimTag = (s: string): Result<Tag, "blank"> => {
  const t = s.trim();
  return t.length > 0 ? ok(t as Tag) : err("blank");
};

const plain = S.object({
  id: S.integer(),
  name: S.string(),
  email: S.string(),
  active: S.boolean(),
  tags: S.array(S.string()),
});
const guarded = S.object({
  id: S.refine(S.integer(), isId),
  name: S.refine(S.string(), isName),
  email: S.refine(S.string(), isEmail),
  active: S.boolean(),
  tags: S.array(S.refine(S.string(), isName)),
});
const constructed = S.object({
  id: S.refine(S.integer(), isId),
  name: S.refine(S.string(), isName),
  email: S.construct(S.string(), asEmail),
  active: S.boolean(),
  tags: S.array(S.construct(S.string(), asTag)),
});
const normalized = S.object({
  id: S.refine(S.integer(), isId),
  name: S.refine(S.string(), isName),
  email: S.construct(S.string(), asEmail),
  active: S.boolean(),
  tags: S.array(S.construct(S.string(), trimTag)),
});

const POOL = 1024;
const MASK = POOL - 1;
const rows = Array.from({ length: POOL }, (_, i) => ({
  id: i,
  name: "user" + i,
  email: "user" + i + "@example.com",
  active: (i & 1) === 0,
  tags: ["admin", "user", "t" + (i % 7)],
}));
const paddedRows = rows.map((r) => ({ ...r, tags: r.tags.map((t) => " " + t + " ") }));
const texts = rows.map((r) => JSON.stringify(r));
const paddedTexts = paddedRows.map((r) => JSON.stringify(r));

const vPlain = validate(plain);
const vGuarded = validate(guarded);
const vConstructed = validate(constructed);
const vNormalized = validate(normalized);
const pPlain = SJ.parse(plain);
const pGuarded = SJ.parse(guarded);
const pConstructed = SJ.parse(constructed);
const pNormalized = SJ.parse(normalized);

let i = 0;

// --- Warm-up ---
{
  for (let k = 0; k < 100_000; k++) {
    const j = k & MASK;
    vPlain(rows[j]);
    vGuarded(rows[j]);
    vConstructed(rows[j]);
    vNormalized(paddedRows[j]);
    pPlain(texts[j]);
    pGuarded(texts[j]);
    pConstructed(texts[j]);
    pNormalized(paddedTexts[j]);
    vPlain(JSON.parse(texts[j]));
    vNormalized(JSON.parse(paddedTexts[j]));
  }
  reportOptimizationStatus(vPlain, "validate plain");
  reportOptimizationStatus(vGuarded, "validate guarded");
  reportOptimizationStatus(vConstructed, "validate constructed");
  reportOptimizationStatus(vNormalized, "validate normalized");
  reportOptimizationStatus(pNormalized, "JSON.parse normalized");
}

// --- validate (JS values) ---

bench("validate — plain row", () => vPlain(rows[i++ & MASK]));
bench("validate — guards (4 brands)", () => vGuarded(rows[i++ & MASK]));
bench("validate — identity constructors (no copy)", () => vConstructed(rows[i++ & MASK]));
bench("validate — trimming constructor (row + tags copied)", () =>
  vNormalized(paddedRows[i++ & MASK]));

// --- JSON text: one pass vs native JSON.parse + validate ---

bench("JSON.parse(plain schema)", () => pPlain(texts[i++ & MASK]));
bench("native JSON.parse + validate(plain)", () => vPlain(JSON.parse(texts[i++ & MASK])));
bench("JSON.parse(guards)", () => pGuarded(texts[i++ & MASK]));
bench("native JSON.parse + validate(guards)", () => vGuarded(JSON.parse(texts[i++ & MASK])));
bench("JSON.parse(identity constructors)", () => pConstructed(texts[i++ & MASK]));
bench("JSON.parse(trimming constructor, in place)", () => pNormalized(paddedTexts[i++ & MASK]));
bench("native JSON.parse + validate(trimming, copies)", () =>
  vNormalized(JSON.parse(paddedTexts[i++ & MASK])));
bench("native JSON.parse only", () => JSON.parse(texts[i++ & MASK]));

await run();

export {};
