// Branded-type standard set: guards, Result vs throwing constructors, and the
// cost of `defineBrand`-derived guards against hand-written ones.
import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import {
  type Branded,
  isPositiveInteger,
  positiveInteger,
  positiveIntegerExn,
  defineBrand,
} from "../FunctionUtils.js";
import { isNonBlank, nonBlank } from "../Text.js";
import { isUUID, uuid } from "../UUID.js";
import { isISODate } from "../ISODate.js";

const N = 1024;
const nums: number[] = [];
const strs: string[] = [];
for (let i = 0; i < N; i++) {
  nums.push(i % 7 === 0 ? -i : i % 11 === 0 ? i + 0.5 : i);
  strs.push(i % 5 === 0 ? ` s${i} ` : i % 13 === 0 ? "" : `slug-${i}`);
}

// --- defineBrand vs hand-written ---
type Slug = Branded<string, "Slug">;
function slugError(v: string): "empty" | "padded" | undefined {
  if (v.length === 0) return "empty";
  return v.charCodeAt(0) === 32 || v.charCodeAt(v.length - 1) === 32 ? "padded" : undefined;
}
function isSlugHand(v: string): v is Slug {
  return slugError(v) === undefined;
}
const SlugOne = defineBrand("Slug", slugError);

// Five more brand definitions whose `is` runs through the same closure code, so the
// shared `check(value)` call site sees several targets (polymorphic).
const others = [
  defineBrand("A", (v: string) => (v.length > 3 ? undefined : "short")),
  defineBrand("B", (v: string) => (v.length < 40 ? undefined : "long")),
  defineBrand("C", (v: string) => (v.charCodeAt(0) !== 45 ? undefined : "dash")),
  defineBrand("D", (v: string) => (v.includes(" ") ? "space" : undefined)),
  defineBrand("E", (v: string) => (v === "x" ? "x" : undefined)),
];

function countHand(): number {
  let c = 0;
  for (let i = 0; i < N; i++) if (isSlugHand(strs[i]!)) c++;
  return c;
}
function countDefined(): number {
  const is = SlugOne.is;
  let c = 0;
  for (let i = 0; i < N; i++) if (is(strs[i]!)) c++;
  return c;
}

// --- Warm-up (single brand definition in use so far) ---
for (let k = 0; k < 2_000; k++) {
  countHand();
  countDefined();
}
reportOptimizationStatus(isSlugHand, "isSlugHand");
reportOptimizationStatus(SlugOne.is, "defineBrand(...).is");

bench("guard x1024: hand-written top-level (check inlined)", countHand);
bench("guard x1024: defineBrand().is, one brand definition in use", countDefined);

bench("guard x1024: defineBrand().is, six brand definitions in use (polymorphic check site)", () => {
  let c = 0;
  for (let i = 0; i < N; i++) {
    const s = strs[i]!;
    if (SlugOne.is(s)) c++;
    for (let j = 0; j < others.length; j++) if (others[j]!.is(s)) c++;
  }
  return c;
});
bench("guard x1024: six hand-written guards (baseline for the line above)", () => {
  let c = 0;
  for (let i = 0; i < N; i++) {
    const s = strs[i]!;
    if (isSlugHand(s)) c++;
    if (s.length > 3) c++;
    if (s.length < 40) c++;
    if (s.charCodeAt(0) !== 45) c++;
    if (!s.includes(" ")) c++;
    if (s !== "x") c++;
  }
  return c;
});

// --- numbers ---
bench("isPositiveInteger x1024", () => {
  let c = 0;
  for (let i = 0; i < N; i++) if (isPositiveInteger(nums[i])) c++;
  return c;
});
bench("positiveInteger (Result) x1024", () => {
  let c = 0;
  for (let i = 0; i < N; i++) if (positiveInteger(nums[i]!)[0]) c++;
  return c;
});
bench("positiveIntegerExn x1024 (valid inputs only)", () => {
  let c = 0;
  for (let i = 1; i < N; i++) c += positiveIntegerExn(i);
  return c;
});

// --- strings ---
const TRIMMED = /^\S(?:[\s\S]*\S)?$/;
bench("isNonBlank x1024 (O(1) char codes)", () => {
  let c = 0;
  for (let i = 0; i < N; i++) if (isNonBlank(strs[i])) c++;
  return c;
});
bench("TRIMMED regex x1024 (baseline)", () => {
  let c = 0;
  for (let i = 0; i < N; i++) if (TRIMMED.test(strs[i]!)) c++;
  return c;
});
bench("nonBlank (Result, trims) x1024", () => {
  let c = 0;
  for (let i = 0; i < N; i++) if (nonBlank(strs[i]!)[0]) c++;
  return c;
});

const ids: string[] = [];
for (let i = 0; i < 64; i++) ids.push(crypto.randomUUID());
const OLD_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
bench("isUUID x64", () => {
  let c = 0;
  for (let i = 0; i < 64; i++) if (isUUID(ids[i])) c++;
  return c;
});
bench("v13 UUID check (toLowerCase + /i regex) x64 (baseline)", () => {
  let c = 0;
  for (let i = 0; i < 64; i++) if (OLD_UUID_RE.test(ids[i]!.toLowerCase())) c++;
  return c;
});
bench("uuid (Result, lower-cases) x64", () => {
  let c = 0;
  for (let i = 0; i < 64; i++) if (uuid(ids[i]!)[0]) c++;
  return c;
});
bench("isISODate (unknown param) x1024", () => {
  let c = 0;
  for (let i = 0; i < N; i++) if (isISODate(i & 1 ? "2024-02-29" : "2023-02-29")) c++;
  return c;
});

await run();
