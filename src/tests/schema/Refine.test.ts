import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as S from "../../schema/Schema.js";
import { validate, type SchemaError } from "../../schema/Validate.js";
import * as SJ from "../../schema/JSON.js";
import { ok, err, type Result } from "../../Result.js";
import type { Branded } from "../../FunctionUtils.js";
import { assertOk, assertErr } from "./_helpers.js";

// ---------------------------------------------------------------------------
// Fixtures: a guard, a normalizing constructor, a custom-type constructor
// ---------------------------------------------------------------------------

type Slug = Branded<string, "Slug">;
type Tag = Branded<string, "Tag">;
type Positive = Branded<number, "Positive">;

const isSlug = (s: string): s is Slug => /^[a-z0-9-]+$/.test(s);
const isSlugAny = (s: unknown): s is Slug => typeof s === "string" && /^[a-z0-9-]+$/.test(s);
const isPositive = (n: number): n is Positive => n > 0;

let tagCalls = 0;
function tag(s: string): Result<Tag, "blank" | "long"> {
  tagCalls++;
  const t = s.trim().toLowerCase();
  if (t === "") return err("blank");
  if (t.length > 8) return err("long");
  return ok(t as Tag);
}

/** Identity brand constructor: output === input, so nothing is copied. */
const asTag = (s: string): Result<Tag, "blank"> => (s === "" ? err("blank") : ok(s as Tag));

const toDate = (s: string): Result<Date, "bad-date"> => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? err("bad-date") : ok(d);
};

// ---------------------------------------------------------------------------
// Types: S.Infer yields the brand / custom type
// ---------------------------------------------------------------------------

test("types: Infer yields the guard's brand; a plain string is not assignable", () => {
  const Slugged = S.refine(S.string(), isSlug);
  const slug: S.Infer<typeof Slugged> = "a" as Slug;
  // @ts-expect-error — a plain string is not a Slug
  const plain: S.Infer<typeof Slugged> = "a";
  // A guard taking `unknown` (the usual shape of library guards) works too
  const Any = S.refine(S.string(), isSlugAny);
  const any: S.Infer<typeof Any> = "a" as Slug;
  // @ts-expect-error — a guard on another base type is rejected
  S.refine(S.string(), isPositive);
  // A plain boolean check keeps the input type (object-level rule)
  const Range = S.refine(S.object({ lo: S.number(), hi: S.number() }), (r) => r.lo <= r.hi);
  const range: S.Infer<typeof Range> = { lo: 1, hi: 2 };
  void [slug, plain, any, range];
});

test("types: Infer yields a constructor's output; encode is required for a foreign type", () => {
  const Tagged = S.construct(S.string(), tag, { at: (e) => (e === "long" ? "" : "") });
  const t: S.Infer<typeof Tagged> = "a" as Tag;
  // @ts-expect-error — a plain string is not a Tag
  const plain: S.Infer<typeof Tagged> = "a";
  // @ts-expect-error — Date is not a string: without encode it is not a Schema
  validate(S.construct(S.string(), toDate));
  const Dated = S.construct(S.string(), toDate, { encode: (d) => d.toISOString() });
  const d: S.Infer<typeof Dated> = new Date(0);
  const Row = S.object({
    tag: Tagged,
    when: S.optional(Dated),
    slug: S.refine(S.string(), isSlug),
  });
  const row: S.Infer<typeof Row> = { tag: "a" as Tag, slug: "s" as Slug };
  // @ts-expect-error — the optional key keeps the constructor's type
  const bad: S.Infer<typeof Row> = { tag: "a" as Tag, slug: "s" as Slug, when: "x" };
  void [t, plain, d, row, bad];
});

test("types: validate and JSON.parse results carry the refined types", () => {
  const Row = S.object({
    slug: S.refine(S.string(), isSlug),
    tags: S.array(S.construct(S.string(), tag)),
  });
  const r = validate(Row)({ slug: "a", tags: [] });
  if (r[0]) {
    const s: Slug = r[1].slug;
    const ts: Tag[] = r[1].tags;
    void [s, ts];
  }
  const p = SJ.parse(Row)('{"slug":"a","tags":[]}');
  if (p[0]) {
    const s: Slug = p[1].slug;
    void s;
  }
});

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

test("refine/construct build a two-property refine node with defaults", () => {
  const g = S.refine(S.string(), isSlug);
  assert.deepEqual(Object.keys(g), ["kind", "meta"]);
  assert.equal(g.kind, "refine");
  assert.equal(g.meta.mode, "guard");
  assert.equal(g.meta.name, "isSlug");
  assert.equal(g.meta.at, undefined);
  assert.equal(S.refine(S.string(), (s) => s !== "").meta.name, "refine");
  const c = S.construct(S.string(), tag, { name: "Tag", at: () => "x" });
  assert.equal(c.meta.mode, "construct");
  assert.equal(c.meta.name, "Tag");
  assert.equal(typeof c.meta.at, "function");
  assert.equal(c.meta.encode, undefined);
  assert.equal(S.construct(S.string(), (s) => ok(s)).meta.name, "construct");
});

// ---------------------------------------------------------------------------
// validate: guards
// ---------------------------------------------------------------------------

test("guard: inner checks run first, then the guard; the value is returned as-is", () => {
  const v = validate(S.refine(S.string({ minLength: 1 }), isSlug));
  assert.equal(assertOk(v("ab-1")), "ab-1");
  assert.deepEqual(assertErr(v("A B")), { path: "", expected: "isSlug", received: "A B" });
  assert.equal(assertErr(v("")).expected, "string(minLength=1)");
  assert.equal(assertErr(v(1)).expected, "string");
});

test("guard: object-level rule reports at options.at under the object's path", () => {
  const Range = S.refine(S.object({ lo: S.number(), hi: S.number() }), (r) => r.lo <= r.hi, {
    name: "lo <= hi",
    at: "hi",
  });
  const v = validate(S.object({ range: Range, list: S.array(Range) }));
  const input = { range: { lo: 1, hi: 2 }, list: [{ lo: 0, hi: 0 }] };
  assert.equal(assertOk(v(input)), input);
  assert.deepEqual(assertErr(v({ range: { lo: 3, hi: 2 }, list: [] })), {
    path: "range.hi",
    expected: "lo <= hi",
    received: { lo: 3, hi: 2 },
  });
  assert.equal(
    assertErr(v({ range: { lo: 1, hi: 2 }, list: [{ lo: 9, hi: 1 }] })).path,
    "list.0.hi",
  );
  // at "" is the value itself
  const self = validate(S.refine(S.number(), (n) => n > 0, { at: "" }));
  assert.equal(assertErr(self(0)).path, "");
});

test("guard: label and sub-path are emitted as escaped literals", () => {
  const hostile = 'x"); throw new Error("pwned"); ("';
  const v = validate(
    S.object({ k: S.refine(S.string(), () => false, { name: hostile, at: hostile }) }),
  );
  const e = assertErr(v({ k: "a" }));
  assert.equal(e.expected, hostile);
  assert.equal(e.path, "k." + hostile);
});

test("guard: inside unions dispatches inline (exact check) and through sub-validators", () => {
  const U = validate(S.union(S.refine(S.string(), isSlug), S.number()));
  assert.equal(assertOk(U("ok-1")), "ok-1");
  assert.equal(assertOk(U(3)), 3);
  assert.equal(assertErr(U("NO")).expected, "number");
  // inner without an exact check (pattern) → compiled boolean sub-validator
  const P = validate(
    S.union(
      S.refine(S.string({ pattern: "^a" }), (s) => s.length < 4),
      S.null_(),
    ),
  );
  assertOk(P("abc"));
  assertErr(P("abcd"));
  assertOk(P(null));
  // a constructor has no exact check either
  const C = validate(S.union(S.construct(S.string(), asTag), S.null_()));
  assertOk(C(null));
  assertErr(C(""));
});

// ---------------------------------------------------------------------------
// validate: constructors
// ---------------------------------------------------------------------------

test("construct: the output replaces the value; the input is never mutated", () => {
  const Row = S.object({
    id: S.construct(S.string(), tag),
    tags: S.array(S.construct(S.string(), tag)),
  });
  const v = validate(Row);
  const input = { id: " News ", tags: ["a", " B "] };
  const out = assertOk(v(input));
  assert.deepEqual(out, { id: "news", tags: ["a", "b"] });
  assert.deepEqual(input, { id: " News ", tags: ["a", " B "] });
  assert.notEqual(out, input);
  assert.notEqual(out.tags, input.tags);
});

test("construct: unchanged containers are returned as-is (no copy)", () => {
  const v = validate(
    S.object({
      a: S.object({ t: S.construct(S.string(), asTag) }),
      b: S.array(S.construct(S.string(), tag)),
    }),
  );
  const input = { a: { t: "x" }, b: ["y"] };
  assert.equal(assertOk(v(input)), input);
  const changed = { a: { t: "x" }, b: ["y", " Z "] };
  const out = assertOk(v(changed));
  assert.equal(out.a, changed.a); // untouched sibling subtree is shared
  assert.notEqual(out.b, changed.b);
});

test("construct: frozen input still validates (copy, not write)", () => {
  const v = validate(S.array(S.object({ t: S.construct(S.string(), tag) })));
  const input = Object.freeze([Object.freeze({ t: " A " })]);
  assert.deepEqual(assertOk(v(input)), [{ t: "a" }]);
});

test("construct: an error surfaces as cause, at the value's path or options.at", () => {
  const v = validate(S.object({ tags: S.array(S.construct(S.string(), tag, { name: "Tag" })) }));
  assert.deepEqual(assertErr(v({ tags: ["ok", "   "] })), {
    path: "tags.1",
    expected: "Tag",
    received: "   ",
    cause: "blank",
  });
  const paths = { inverted: "hi", empty: "" } as const;
  const Range = S.construct(
    S.object({ lo: S.number(), hi: S.number() }),
    (r): Result<{ lo: number; hi: number }, "inverted" | "empty"> =>
      r.lo > r.hi ? err("inverted") : r.lo === r.hi ? err("empty") : ok(r),
    { at: (e) => paths[e] },
  );
  const w = validate(S.object({ r: Range }));
  assert.equal(assertErr(w({ r: { lo: 2, hi: 1 } })).path, "r.hi");
  assert.equal(assertErr(w({ r: { lo: 1, hi: 1 } })).path, "r");
  const root = validate(Range);
  assert.equal(assertErr(root({ lo: 2, hi: 1 })).path, "hi");
});

test("construct: a custom (non-string) type, and a domain object built from a shape", () => {
  const v = validate(
    S.object({ at: S.construct(S.string(), toDate, { encode: (d) => d.toISOString() }) }),
  );
  const out = assertOk(v({ at: "2024-01-02T00:00:00Z" }));
  assert.ok(out.at instanceof Date);
  assert.equal(assertErr(v({ at: "nope" })).cause, "bad-date");
  // object-level constructor: keys beyond the declared ones are not copied
  const Source = S.construct(
    S.object({ id: S.string(), name: S.string() }, { additionalProperties: true }),
    (o) => ok({ id: o.id as Slug, name: o.name.trim() }),
  );
  assert.deepEqual(assertOk(validate(Source)({ id: "s", name: " N ", extra: 1 })), {
    id: "s",
    name: "N",
  });
});

test("construct: tuples, records, nullable/optional wrappers, and __proto__ keys", () => {
  const T = validate(S.tuple(S.construct(S.string(), tag), S.integer()));
  const ti = [" X ", 1];
  assert.deepEqual(assertOk(T(ti)), ["x", 1]);
  assert.deepEqual(ti, [" X ", 1]);
  assert.equal(assertOk(T(["x", 1])).length, 2);
  const R = validate(S.record(S.construct(S.string(), tag)));
  const ri = JSON.parse('{"a":" A ","__proto__":" P "}') as Record<string, string>;
  const ro = assertOk(R(ri));
  assert.equal(Object.getPrototypeOf(ro), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(ro, "__proto__")?.value, "p");
  assert.equal(ro.a, "a");
  const O = validate(
    S.object({
      ["__proto__"]: S.construct(S.string(), tag),
      n: S.nullable(S.construct(S.string(), tag)),
      o: S.optional(S.construct(S.string(), tag)),
    }),
  );
  const oi = JSON.parse('{"__proto__":" Q ","n":null}') as object;
  const oo = assertOk(O(oi)) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(oo), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(oo, "__proto__")?.value, "q");
  assert.equal(oo.n, null);
  assert.equal(Object.hasOwn(oo, "o"), false);
});

test("construct: refine(optional(T)) sees undefined; a constructor may fill a default", () => {
  const v = validate(S.object({ n: S.construct(S.optional(S.integer()), (x) => ok(x ?? 0)) }));
  assert.deepEqual(assertOk(v({})), { n: 0 });
  assert.deepEqual(assertOk(v({ n: 5 })), { n: 5 });
});

test("construct: discriminated union writes the matched variant's fields", () => {
  const U = S.union(
    S.object({ kind: S.literal("a"), t: S.construct(S.string(), tag) }),
    S.object({ kind: S.literal("b"), n: S.integer() }),
  );
  const v = validate(U);
  assert.deepEqual(assertOk(v({ kind: "a", t: " A " })), { kind: "a", t: "a" });
  const b = { kind: "b", n: 1 };
  assert.equal(assertOk(v(b)), b);
  assert.equal(assertErr(v({ kind: "a", t: " " })).path, "t");
});

test("construct: untagged union keeps the matched variant's output", () => {
  const v = validate(S.union(S.construct(S.string(), tag), S.number()));
  assert.equal(assertOk(v(" Hi ")), "hi");
  assert.equal(assertOk(v(2)), 2);
  // the last variant is validated inline and reports its own error
  assert.equal(assertErr(v("   ")).expected, "number");
  const w = validate(S.union(S.number(), S.construct(S.string(), tag)));
  assert.deepEqual(assertErr(w("   ")), {
    path: "",
    expected: "tag",
    received: "   ",
    cause: "blank",
  });
  // a matched non-transforming variant before a transforming one
  const x = validate(S.union(S.literal("A"), S.construct(S.string(), tag), S.null_()));
  assert.equal(assertOk(x("A")), "A");
  assert.equal(assertOk(x(" B ")), "b");
});

test("construct: oneOf produces the single winner's output, else reports", () => {
  const v = validate(
    S.oneOf(
      S.construct(S.string(), tag),
      S.number(),
      S.construct(S.boolean(), (b) => ok(b ? 1 : 0), { encode: (n) => n === 1 }),
    ),
  );
  assert.equal(assertOk(v(" X ")), "x");
  assert.equal(assertOk(v(7)), 7);
  assert.equal(assertOk(v(true)), 1);
  assertErr(v(null));
  const two = validate(S.oneOf(S.construct(S.string(), tag), S.string()));
  assert.match(assertErr(two("a")).expected, /matched 2/);
});

test("construct: allOf runs its variants in order on the transformed value", () => {
  const v = validate(
    S.allOf(
      S.construct(S.string(), tag),
      S.refine(S.string(), (s) => s === s.toLowerCase(), { name: "lower" }),
    ),
  );
  assert.equal(assertOk(v(" ABC ")), "abc");
});

test("construct: conditional branches transform; not() and if only decide", () => {
  const C = validate(
    S.conditional(
      S.construct(S.string(), tag),
      S.construct(S.string(), (s) => ok(s + "!")),
      S.number(),
    ),
  );
  // `if` decides on its own (check-only) run; the branch sees the original value
  assert.equal(assertOk(C(" a ")), " a !");
  assert.equal(assertOk(C(3)), 3);
  const N = validate(S.not(S.construct(S.string(), tag)));
  assert.equal(assertOk(N("   ")), "   ");
  assertErr(N(" a "));
});

test("construct: a refinement over an object sees its transformed fields", () => {
  const Obj = S.refine(S.object({ t: S.construct(S.string(), tag) }), (o) => o.t === "x", {
    name: "is x",
  });
  assert.deepEqual(assertOk(validate(Obj)({ t: " X " })), { t: "x" });
  // the same inside a union trial (boolean sub-validator) and a conditional's if
  const U = validate(S.union(Obj, S.null_()));
  assert.deepEqual(assertOk(U({ t: " X " })), { t: "x" });
  const C = validate(S.conditional(Obj, S.unknown(), S.null_()));
  assertOk(C({ t: " X " }));
});

test("construct: an untagged union runs the winner's constructor twice (trial + output)", () => {
  tagCalls = 0;
  validate(S.union(S.construct(S.string(), tag), S.number()))(" a ");
  assert.equal(tagCalls, 2);
  tagCalls = 0;
  validate(S.construct(S.string(), tag))(" a ");
  assert.equal(tagCalls, 1);
});

// ---------------------------------------------------------------------------
// allErrors
// ---------------------------------------------------------------------------

test("allErrors: constructor errors are collected; a refinement skips a value with errors", () => {
  let guardCalls = 0;
  const v = validate(
    S.object({
      t: S.construct(S.string(), tag),
      s: S.refine(S.string({ minLength: 3 }), (s) => (guardCalls++, s !== "bad")),
      n: S.refine(S.integer(), isPositive),
    }),
    { allErrors: true },
  );
  const errors = assertAllErr(v({ t: " ", s: "x", n: -1, extra: 0 }));
  assert.deepEqual(
    errors.map((e) => [e.path, e.expected]),
    [
      ["t", "tag"],
      ["s", "string(minLength=3)"],
      ["n", "isPositive"],
      ["extra", "no additional properties"],
    ],
  );
  assert.equal(guardCalls, 0); // minLength failed: the guard did not run
  assert.equal(errors[0].cause, "blank");
  const out = v({ t: " A ", s: "good", n: 1 });
  assert.deepEqual(out, [true, { t: "a", s: "good", n: 1 }]);
});

function assertAllErr(r: Result<unknown, SchemaError[]>): SchemaError[] {
  /* node:coverage ignore next 2 */
  if (r[0]) throw new Error("Expected Err but got Ok");
  return r[1];
}

// ---------------------------------------------------------------------------
// Compile-time checks
// ---------------------------------------------------------------------------

test("a malformed name throws TypeError at compile time, even in a skipped `if`", () => {
  const bad = S.refine(S.string(), isSlug, { name: {} as unknown as string });
  assert.throws(() => validate(bad), TypeError);
  const badAt = S.refine(S.string(), isSlug, { at: {} as unknown as string });
  // a non-string `at` on a guard is ignored (reports at the value itself)
  assert.equal(assertErr(validate(badAt)("A")).path, "");
  const x = S.string();
  assert.throws(() => validate(S.conditional(bad, x, x)), TypeError);
});

test("propertyMayBeAbsent / isPrimitive see through refinements", () => {
  assert.equal(S.propertyMayBeAbsent(S.refine(S.optional(S.string()), () => true)), true);
  assert.equal(S.propertyMayBeAbsent(S.refine(S.string(), isSlug)), false);
  assert.equal(
    S.propertyMayBeAbsent(
      S.union(
        S.refine(S.optional(S.string()), () => true),
        S.number(),
      ),
    ),
    true,
  );
  assert.equal(
    S.propertyMayBeAbsent(S.nullable(S.refine(S.optional(S.string()), () => true))),
    true,
  );
  assert.equal(S.isPrimitive(S.optional(S.refine(S.string(), isSlug))), true);
  // a key that may be absent is allowed to be absent
  const v = validate(S.object({ a: S.refine(S.optional(S.string()), (s) => s !== "x") }));
  assertOk(v({}));
  assertErr(v({ a: "x" }));
});

// ---------------------------------------------------------------------------
// toJsonSchema / fromJsonSchema
// ---------------------------------------------------------------------------

test("toJsonSchema: a refinement throws by default, never silently loosens", () => {
  assert.throws(
    () => S.toJsonSchema(S.object({ s: S.refine(S.string(), isSlug) })),
    /refinement "isSlug" has no JSON Schema form/,
  );
});

test('toJsonSchema: { refinements: "base" } emits the base with a $comment', () => {
  const shared = S.string({ minLength: 1 });
  const js = S.toJsonSchema(
    S.object({
      a: S.refine(shared, isSlug),
      b: shared,
      c: S.refine(S.refine(S.integer(), isPositive), (n) => n < 9, { name: "small" }),
      d: S.optional(S.construct(S.string(), tag)),
    }),
    { refinements: "base" },
  );
  assert.deepEqual(js, {
    type: "object",
    properties: {
      a: { type: "string", minLength: 1, $comment: "refinement: isSlug" },
      b: { type: "string", minLength: 1 },
      c: { type: "integer", $comment: "refinement: isPositive; refinement: small" },
      d: { type: "string", $comment: "refinement: tag" },
    },
    required: ["a", "b", "c"],
    additionalProperties: false,
  });
  // the base round-trips through fromJsonSchema (which never makes refinements)
  const back = S.fromJsonSchema(js);
  assert.equal(back[0], true);
  const check = validate(back[1] as S.StringSchema) as (x: unknown) => Result<unknown, unknown>;
  assert.equal(check({ a: "x", b: "y", c: 1 })[0], true);
});
