/**
 * Arbitrary — property-based testing generators with integrated shrinking.
 *
 * Each `Arbitrary<T>` is a function `(prng, size) => Tree<T>` that produces a
 * rose tree: a generated value paired with a lazy iterable of progressively
 * simpler shrink candidates. Shrinking is integrated — it composes
 * automatically through `map`, `chain`, `filter`, and all other combinators,
 * so users never write shrink functions.
 *
 * When to use: building generators for property-based tests via the Property
 * module. Compose built-in arbitraries (`integer`, `string`, `array`, etc.)
 * with combinators (`map`, `chain`, `filter`, `oneOf`) to describe the shape
 * of your test data. Use `letrec` for recursive structures (JSON, ASTs) and
 * `gen` for imperative-style generation.
 *
 * Internal design:
 *   Tree<T>.value: T — the generated value at this node.
 *   Tree<T>.shrinks: Iterable<Tree<T>> — lazy children (shrink candidates).
 *
 * Design tradeoffs: `Iterable` (not `Array`) for shrinks keeps the happy path
 * (no failures) allocation-free beyond the root Tree node — generator functions
 * produce children only when the runner traverses during shrinking. The
 * `Arbitrary<T>` type is a plain function (not a class) to match vjuga's
 * `Validator<T>` pattern and keep combinator call sites monomorphic.
 *
 * Prior art: Hedgehog (Haskell), fast-check (TypeScript).
 *
 * @example
 * ```ts
 * import * as Arb from "vjuga/Arbitrary.js";
 * import * as Prop from "vjuga/Property.js";
 * const pairs = Arb.tuple(Arb.integer(-100, 100), Arb.string());
 * Prop.assert(pairs, ([n, s]) => typeof n === "number" && typeof s === "string");
 * ```
 */

import type { Fn1, Predicate } from "./FunctionUtils.js";
import { type PRNG, type Seed, next, nextInt, nextBigInt, split } from "./PRNG.js";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Rose tree: a value paired with a lazy iterable of shrink candidates. */
export interface Tree<T> {
  readonly value: T;
  readonly shrinks: Iterable<Tree<T>>;
}

/**
 * A generator of random values with integrated shrinking.
 * Given a PRNG and a size parameter, produces a rose tree whose root is the
 * generated value and whose children are progressively simpler alternatives.
 */
export type Arbitrary<T> = (this: void, prng: PRNG, size: number) => Tree<T>;

// ---------------------------------------------------------------------------
// Tree utilities (internal)
// ---------------------------------------------------------------------------

const NO_SHRINKS: readonly Tree<never>[] = [];

function leaf<T>(value: T): Tree<T> {
  return { value, shrinks: NO_SHRINKS };
}

function* mapShrinks<T, U>(shrinks: Iterable<Tree<T>>, fn: Fn1<T, U>): Iterable<Tree<U>> {
  for (const child of shrinks) {
    yield mapTree(child, fn);
  }
}

function mapTree<T, U>(tree: Tree<T>, fn: Fn1<T, U>): Tree<U> {
  return { value: fn(tree.value), shrinks: mapShrinks(tree.shrinks, fn) };
}

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

/** Transforms the generated value while preserving the shrink tree structure. */
export function map<T, U>(arb: Arbitrary<T>, fn: Fn1<T, U>): Arbitrary<U> {
  return function mappedArb(prng: PRNG, size: number): Tree<U> {
    return mapTree(arb(prng, size), fn);
  };
}

/**
 * Monadic bind — generates a value from `arb`, then uses it to select a second
 * arbitrary via `fn`. Shrinks the inner value first, then the outer.
 */
export function chain<T, U>(arb: Arbitrary<T>, fn: Fn1<T, Arbitrary<U>>): Arbitrary<U> {
  return function chainedArb(prng: PRNG, size: number): Tree<U> {
    const prng2 = split(prng);
    const outerTree = arb(prng, size);
    const innerArb = fn(outerTree.value);
    const innerTree = innerArb(prng2, size);
    return {
      value: innerTree.value,
      shrinks: chainShrinks(outerTree, innerTree, fn, prng2, size),
    };
  };
}

function* chainShrinks<T, U>(
  outerTree: Tree<T>,
  innerTree: Tree<U>,
  fn: Fn1<T, Arbitrary<U>>,
  prng2: PRNG,
  size: number,
): Iterable<Tree<U>> {
  // Phase 1: shrink inner value (keep outer fixed)
  yield* innerTree.shrinks;
  // Phase 2: shrink outer value (re-derive inner at root level)
  for (const outerShrink of outerTree.shrinks) {
    const newInnerArb = fn(outerShrink.value);
    const newInner = newInnerArb(split(prng2), size);
    yield {
      value: newInner.value,
      shrinks: chainShrinks(outerShrink, newInner, fn, prng2, size),
    };
  }
}

/**
 * Filters generated values by a predicate. Uses rejection sampling — retries
 * up to `maxRetries` (default 100) times before throwing.
 */
export function filter<T>(arb: Arbitrary<T>, pred: Predicate<T>, maxRetries = 100): Arbitrary<T> {
  return function filteredArb(prng: PRNG, size: number): Tree<T> {
    for (let i = 0; i < maxRetries; i++) {
      const tree = arb(split(prng), size);
      if (pred(tree.value)) {
        return { value: tree.value, shrinks: filterShrinks(tree.shrinks, pred) };
      }
    }
    throw new Error(`filter: failed to find a value after ${maxRetries} retries`);
  };
}

/* c8 ignore start -- implicit else branch on pred(child.value) false */
function* filterShrinks<T>(shrinks: Iterable<Tree<T>>, pred: Predicate<T>): Iterable<Tree<T>> {
  for (const child of shrinks) {
    if (pred(child.value)) {
      yield { value: child.value, shrinks: filterShrinks(child.shrinks, pred) };
    }
  }
}
/* c8 ignore stop */

// ---------------------------------------------------------------------------
// Shrink helpers (internal)
// ---------------------------------------------------------------------------

/**
 * Binary-search shrink toward `target` from `current`.
 * Converges in O(log |current - target|) steps.
 */
/* c8 ignore start -- generator early-return branches */
function* shrinkNumber(target: number, current: number): Iterable<Tree<number>> {
  if (target === current) return;
  // Try target directly first
  yield { value: target, shrinks: NO_SHRINKS };
  // Then binary search
  let lo = target;
  let hi = current;
  while (true) {
    const mid = (lo + (hi - lo) / 2) | 0;
    if (mid === lo || mid === hi) break;
    yield { value: mid, shrinks: shrinkNumber(target, mid) };
    lo = mid;
  }
}

/**
 * Binary-search shrink for bigint toward `target` from `current`.
 */
function* shrinkBigInt(target: bigint, current: bigint): Iterable<Tree<bigint>> {
  if (target === current) return;
  yield { value: target, shrinks: NO_SHRINKS };
  let lo = target;
  let hi = current;
  while (true) {
    const mid = lo + (hi - lo) / 2n;
    if (mid === lo || mid === hi) break;
    yield { value: mid, shrinks: shrinkBigInt(target, mid) };
    lo = mid;
  }
}
/* c8 ignore stop */

/**
 * Shrink an array by removing elements (binary search on length), then
 * shrinking individual elements in place.
 */
function* shrinkArray<T>(trees: Tree<T>[], minLength: number): Iterable<Tree<T[]>> {
  const len = trees.length;
  // Phase 1: remove elements (try halving, then removing one)
  if (len > minLength) {
    // Try removing half
    for (let removeCount = len - minLength; removeCount > 0; removeCount = (removeCount / 2) | 0) {
      for (let offset = 0; offset < len; offset += removeCount) {
        const candidate = [...trees.slice(0, offset), ...trees.slice(offset + removeCount)];
        if (candidate.length >= minLength) {
          yield {
            value: candidate.map((t) => t.value),
            shrinks: shrinkArray(candidate, minLength),
          };
        }
      }
      if (removeCount === 1) break;
    }
  }
  // Phase 2: shrink individual elements
  for (let i = 0; i < trees.length; i++) {
    for (const childTree of trees[i]!.shrinks) {
      const copy = trees.slice();
      copy[i] = childTree;
      yield {
        value: copy.map((t) => t.value),
        shrinks: shrinkArray(copy, minLength),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Built-in arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates integers in [min, max] (inclusive). Shrinks toward 0 (or the
 * nearest bound if 0 is outside the range).
 */
export function integer(min = -0x7fff_ffff, max = 0x7fff_ffff): Arbitrary<number> {
  const target = min <= 0 && max >= 0 ? 0 : min > 0 ? min : max;
  return function integerArb(prng: PRNG, size: number): Tree<number> {
    // Scale range by size parameter
    const sizedMin = Math.max(min, target - size);
    const sizedMax = Math.min(max, target + size);
    const value = nextInt(prng, sizedMin, sizedMax);
    return { value, shrinks: shrinkNumber(target, value) };
  };
}

/** Generates non-negative integers in [0, max]. Shrinks toward 0. */
export function nat(max = 0x7fff_ffff): Arbitrary<number> {
  return integer(0, max);
}

/** Generates floating-point numbers in [min, max). Shrinks toward 0. */
export function float(min = -1e10, max = 1e10): Arbitrary<number> {
  /* c8 ignore next -- ternary branches */
  const target = min <= 0 && max >= 0 ? 0 : min > 0 ? min : max;
  return function floatArb(prng: PRNG, _size: number): Tree<number> {
    const value = min + next(prng) * (max - min);
    return { value, shrinks: shrinkFloat(target, value) };
  };
}

/* c8 ignore start -- generator branches */
function* shrinkFloat(target: number, current: number): Iterable<Tree<number>> {
  if (target === current) return;
  yield { value: target, shrinks: NO_SHRINKS };
  // Try truncating to integer
  const truncated = Math.trunc(current);
  if (truncated !== current && truncated !== target) {
    yield { value: truncated, shrinks: shrinkFloat(target, truncated) };
  }
  // Binary search
  let lo = target;
  let hi = current;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    yield { value: mid, shrinks: shrinkFloat(target, mid) };
    lo = mid;
  }
}
/* c8 ignore stop */

/** Generates booleans. Shrinks toward false. */
export function boolean(): Arbitrary<boolean> {
  return function booleanArb(prng: PRNG, _size: number): Tree<boolean> {
    const value = next(prng) < 0.5;
    if (!value) return leaf(false);
    return { value: true, shrinks: [leaf(false)] };
  };
}

/** Always produces the same value with no shrinks. */
export function constant<T>(value: T): Arbitrary<T> {
  const tree = leaf(value);
  return function constantArb(_prng: PRNG, _size: number): Tree<T> {
    return tree;
  };
}

/** Picks one of the provided values uniformly. Shrinks toward the first value. */
export function constantFrom<T>(...values: [T, ...T[]]): Arbitrary<T> {
  return function constantFromArb(prng: PRNG, _size: number): Tree<T> {
    const idx = nextInt(prng, 0, values.length - 1);
    const value = values[idx]!;
    if (idx === 0) return leaf(value);
    return { value, shrinks: [leaf(values[0]!)] };
  };
}

/**
 * Generates strings of printable ASCII characters. Shrinks by removing
 * characters, then by replacing characters with 'a'.
 */
export function string(opts?: { minLength?: number; maxLength?: number }): Arbitrary<string> {
  /* c8 ignore next 2 -- opts defaults */
  const minLen = opts?.minLength ?? 0;
  const maxLen = opts?.maxLength ?? 10;
  return function stringArb(prng: PRNG, size: number): Tree<string> {
    const sizedMax = Math.min(maxLen, Math.max(minLen, size));
    const len = nextInt(prng, minLen, sizedMax);
    const chars: number[] = [];
    for (let i = 0; i < len; i++) {
      chars.push(nextInt(prng, 0x20, 0x7e));
    }
    const value = String.fromCharCode(...chars);
    return { value, shrinks: shrinkString(value, minLen) };
  };
}

/* c8 ignore start -- generator branches */
function* shrinkString(current: string, minLength: number): Iterable<Tree<string>> {
  if (current.length <= minLength) return;
  // Try empty string
  if (minLength === 0 && current.length > 0) {
    yield leaf("");
  }
  // Remove characters
  for (let i = current.length - 1; i >= minLength; i--) {
    const shorter = current.slice(0, i) + current.slice(i + 1);
    if (shorter.length >= minLength) {
      yield { value: shorter, shrinks: shrinkString(shorter, minLength) };
      break; // one removal is enough, shrinker will recurse
    }
  }
  // Simplify characters toward 'a'
  for (let i = 0; i < current.length; i++) {
    if (current[i] !== "a") {
      const simplified = current.slice(0, i) + "a" + current.slice(i + 1);
      yield { value: simplified, shrinks: shrinkString(simplified, minLength) };
      break;
    }
  }
}
/* c8 ignore stop */

/**
 * Generates arrays of values from `arb`. Shrinks by removing elements, then
 * shrinking individual elements.
 */
export function array<T>(
  arb: Arbitrary<T>,
  opts?: { minLength?: number; maxLength?: number },
): Arbitrary<T[]> {
  /* c8 ignore next 2 -- opts defaults */
  const minLen = opts?.minLength ?? 0;
  const maxLen = opts?.maxLength ?? 10;
  return function arrayArb(prng: PRNG, size: number): Tree<T[]> {
    const sizedMax = Math.min(maxLen, Math.max(minLen, size));
    const len = nextInt(prng, minLen, sizedMax);
    const trees: Tree<T>[] = [];
    for (let i = 0; i < len; i++) {
      trees.push(arb(split(prng), size));
    }
    return {
      value: trees.map((t) => t.value),
      shrinks: shrinkArray(trees, minLen),
    };
  };
}

/** Generates tuples from a fixed list of arbitraries. Shrinks element-wise. */
export function tuple<T extends readonly unknown[]>(
  ...arbs: { [K in keyof T]: Arbitrary<T[K]> }
): Arbitrary<T> {
  return function tupleArb(prng: PRNG, size: number): Tree<T> {
    const trees = arbs.map((arb) => (arb as Arbitrary<unknown>)(split(prng), size));
    return {
      value: trees.map((t) => t.value) as unknown as T,
      shrinks: shrinkTuple(trees) as Iterable<Tree<T>>,
    };
  };
}

/* c8 ignore start -- generator closing braces counted as uncovered by c8 */
function* shrinkTuple(trees: Tree<unknown>[]): Iterable<Tree<unknown[]>> {
  for (let i = 0; i < trees.length; i++) {
    for (const childTree of trees[i]!.shrinks) {
      const copy = trees.slice();
      copy[i] = childTree;
      yield {
        value: copy.map((t) => t.value),
        shrinks: shrinkTuple(copy),
      };
    }
  }
}
/* c8 ignore stop */

/**
 * Generates objects matching a shape of arbitraries. Shrinks field-wise.
 */
export function record<T extends Record<string, unknown>>(shape: {
  [K in keyof T]: Arbitrary<T[K]>;
}): Arbitrary<T> {
  const keys = Object.keys(shape) as (keyof T & string)[];
  return function recordArb(prng: PRNG, size: number): Tree<T> {
    const treePairs: [string, Tree<unknown>][] = [];
    for (const key of keys) {
      treePairs.push([key, (shape[key] as Arbitrary<unknown>)(split(prng), size)]);
    }
    const value = Object.fromEntries(treePairs.map(([k, t]) => [k, t.value])) as T;
    return { value, shrinks: shrinkRecord(treePairs) as Iterable<Tree<T>> };
  };
}

/* c8 ignore start -- generator closing brace counted as uncovered by c8 */
function* shrinkRecord(pairs: [string, Tree<unknown>][]): Iterable<Tree<Record<string, unknown>>> {
  for (let i = 0; i < pairs.length; i++) {
    const [key, tree] = pairs[i]!;
    for (const childTree of tree.shrinks) {
      const copy = pairs.slice();
      copy[i] = [key, childTree];
      yield {
        value: Object.fromEntries(copy.map(([k, t]) => [k, t.value])),
        shrinks: shrinkRecord(copy),
      };
    }
  }
}
/* c8 ignore stop */

/**
 * Picks one of the provided arbitraries uniformly. Shrinks using the chosen
 * arbitrary's shrink tree, then tries earlier arbitraries.
 */
export function oneOf<T>(...arbs: [Arbitrary<T>, ...Arbitrary<T>[]]): Arbitrary<T> {
  return function oneOfArb(prng: PRNG, size: number): Tree<T> {
    const idx = nextInt(prng, 0, arbs.length - 1);
    const tree = arbs[idx]!(split(prng), size);
    if (idx === 0) return tree;
    return {
      value: tree.value,
      shrinks: oneOfShrinks(tree, arbs, idx, prng, size),
    };
  };
}

function* oneOfShrinks<T>(
  tree: Tree<T>,
  arbs: Arbitrary<T>[],
  idx: number,
  prng: PRNG,
  size: number,
): Iterable<Tree<T>> {
  // First: shrink within the chosen arbitrary
  yield* tree.shrinks;
  // Then: try earlier arbitraries (shrink toward first)
  for (let i = 0; i < idx; i++) {
    yield arbs[i]!(split(prng), size);
  }
}

// ---------------------------------------------------------------------------
// Extended arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates bigints in [min, max] (inclusive). Shrinks toward 0n (or the
 * nearest bound).
 */
export function bigint(
  min = -0x7fff_ffff_ffff_ffffn,
  max = 0x7fff_ffff_ffff_ffffn,
): Arbitrary<bigint> {
  /* c8 ignore next -- ternary branches */
  const target = min <= 0n && max >= 0n ? 0n : min > 0n ? min : max;
  return function bigintArb(prng: PRNG, size: number): Tree<bigint> {
    // Scale range by size
    const sizeN = BigInt(size);
    /* c8 ignore next 2 -- ternary branches */
    const sizedMin = min < target - sizeN ? target - sizeN : min;
    const sizedMax = max > target + sizeN ? target + sizeN : max;
    const range = sizedMax - sizedMin;
    let value: bigint;
    if (range <= 0n) {
      value = sizedMin;
    } else {
      const raw = nextBigInt(prng);
      // Map raw 64-bit value into [sizedMin, sizedMax]
      /* c8 ignore next -- ternary branch for abs(raw) */
      value = sizedMin + ((raw < 0n ? -raw : raw) % (range + 1n));
    }
    return { value, shrinks: shrinkBigInt(target, value) };
  };
}

/**
 * Generates Date objects in [min, max]. Shrinks toward the Unix epoch.
 */
export function date(
  min = new Date(-8640000000000000),
  max = new Date(8640000000000000),
): Arbitrary<Date> {
  const intArb = integer(min.getTime(), max.getTime());
  return map(intArb, (ms) => new Date(ms));
}

/**
 * Generates arrays with unique elements (by identity or custom key).
 * Shrinks by removing elements, then shrinking individual elements.
 */
export function uniqueArray<T>(
  arb: Arbitrary<T>,
  opts?: { minLength?: number; maxLength?: number; key?: Fn1<T, unknown> },
): Arbitrary<T[]> {
  /* c8 ignore next 3 -- opts defaults */
  const minLen = opts?.minLength ?? 0;
  const maxLen = opts?.maxLength ?? 10;
  const keyFn = opts?.key ?? ((x: T) => x);
  return function uniqueArrayArb(prng: PRNG, size: number): Tree<T[]> {
    const sizedMax = Math.min(maxLen, Math.max(minLen, size));
    const targetLen = nextInt(prng, minLen, sizedMax);
    const trees: Tree<T>[] = [];
    const seen = new Set<unknown>();
    let attempts = 0;
    while (trees.length < targetLen && attempts < targetLen * 10) {
      const tree = arb(split(prng), size);
      const k = keyFn(tree.value);
      if (!seen.has(k)) {
        seen.add(k);
        trees.push(tree);
      }
      attempts++;
    }
    return {
      value: trees.map((t) => t.value),
      shrinks: shrinkUniqueArray(trees, minLen, keyFn),
    };
  };
}

function* shrinkUniqueArray<T>(
  trees: Tree<T>[],
  minLength: number,
  keyFn: Fn1<T, unknown>,
): Iterable<Tree<T[]>> {
  // Removal shrinks — delegate to shrinkArray and filter for uniqueness
  for (const candidate of shrinkArray(trees, minLength)) {
    const keys = candidate.value.map(keyFn);
    if (new Set(keys).size === keys.length) {
      yield candidate;
    }
  }
}

/**
 * Generates objects with arbitrary string keys and values from `valueArb`.
 * Shrinks by removing entries, then shrinking values.
 */
export function dictionary<V>(
  keyArb: Arbitrary<string>,
  valueArb: Arbitrary<V>,
  opts?: { minSize?: number; maxSize?: number },
): Arbitrary<Record<string, V>> {
  const pairArb = tuple<[string, V]>(keyArb, valueArb);
  const arrArb = uniqueArray(pairArb, {
    /* c8 ignore next 2 -- opts defaults */
    minLength: opts?.minSize ?? 0,
    maxLength: opts?.maxSize ?? 10,
    key: ([k]) => k,
  });
  return map(arrArb, (pairs) => Object.fromEntries(pairs) as Record<string, V>);
}

/**
 * Weighted choice among arbitraries. Each entry is `{ weight, arb }`.
 * Higher weight = more likely to be chosen. Shrinks toward the highest-weight
 * arbitrary's values.
 */
export function frequency<T>(
  ...entries: [{ weight: number; arb: Arbitrary<T> }, ...{ weight: number; arb: Arbitrary<T> }[]]
): Arbitrary<T> {
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  // Sort by weight descending for shrinking (try highest-weight first)
  const sorted = entries.slice().sort((a, b) => b.weight - a.weight);
  return function frequencyArb(prng: PRNG, size: number): Tree<T> {
    const r = next(prng) * totalWeight;
    let cumulative = 0;
    let chosen = 0;
    for (let i = 0; i < entries.length; i++) {
      cumulative += entries[i]!.weight;
      if (r < cumulative) {
        chosen = i;
        break;
      }
    }
    const tree = entries[chosen]!.arb(split(prng), size);
    // Find position in sorted order for shrinking
    const chosenArb = entries[chosen]!.arb;
    return {
      value: tree.value,
      shrinks: frequencyShrinks(tree, sorted, chosenArb, prng, size),
    };
  };
}

function* frequencyShrinks<T>(
  tree: Tree<T>,
  sorted: { weight: number; arb: Arbitrary<T> }[],
  chosenArb: Arbitrary<T>,
  prng: PRNG,
  size: number,
): Iterable<Tree<T>> {
  // Shrink within chosen arbitrary
  yield* tree.shrinks;
  // Try higher-weight arbitraries
  for (const entry of sorted) {
    if (entry.arb !== chosenArb) {
      yield entry.arb(split(prng), size);
    }
  }
}

/**
 * Generates a subsequence of the provided array. Shrinks toward the empty
 * subsequence.
 */
export function subarray<T>(items: readonly T[]): Arbitrary<T[]> {
  return function subarrayArb(prng: PRNG, size: number): Tree<T[]> {
    const maxLen = Math.min(items.length, size);
    const len = nextInt(prng, 0, maxLen);
    // Fisher-Yates partial shuffle to pick `len` unique indices
    const indices = items.map((_, i) => i);
    for (let i = 0; i < len; i++) {
      const j = nextInt(prng, i, indices.length - 1);
      const tmp = indices[i]!;
      indices[i] = indices[j]!;
      indices[j] = tmp;
    }
    const selected = indices.slice(0, len).sort((a, b) => a - b);
    const value = selected.map((i) => items[i]!);
    return { value, shrinks: shrinkSubarray(value, items) };
  };
}

function* shrinkSubarray<T>(current: T[], _source: readonly T[]): Iterable<Tree<T[]>> {
  /* c8 ignore next 2 -- early return for empty */
  if (current.length === 0) return;
  // Try empty
  yield leaf([]);
  // Remove elements one at a time
  for (let i = current.length - 1; i >= 0; i--) {
    const shorter = [...current.slice(0, i), ...current.slice(i + 1)];
    yield { value: shorter, shrinks: shrinkSubarray(shorter, _source) };
  }
}

// ---------------------------------------------------------------------------
// Advanced combinators
// ---------------------------------------------------------------------------

/**
 * Defines mutually recursive arbitraries. The `tie` function receives a
 * lazy reference that can be used in generator definitions before they exist.
 *
 * @example
 * ```ts
 * const { json } = letrec((tie) => ({
 *   json: oneOf(integer(), string(), array(tie("json"))),
 * }));
 * ```
 */
export function letrec<Shape extends Record<string, Arbitrary<unknown>>>(
  tie: (ref: (name: keyof Shape & string) => Arbitrary<unknown>) => Shape,
): Shape {
  const cache = new Map<string, Arbitrary<unknown>>();
  const ref = (name: string): Arbitrary<unknown> => {
    return function lazyArb(prng: PRNG, size: number): Tree<unknown> {
      const resolved = cache.get(name);
      /* c8 ignore next 2 -- defensive guard; tested via dedicated test */
      if (!resolved) throw new Error(`letrec: unresolved reference "${name}"`);
      // Reduce size to ensure termination of recursive structures
      return resolved(prng, Math.max(0, size - 1));
    };
  };
  const shape = tie(ref);
  for (const [name, arb] of Object.entries(shape)) {
    cache.set(name, arb);
  }
  return shape;
}

/**
 * Callback passed to `gen()` — allows imperative-style generation by drawing
 * values from arbitraries inline.
 */
export interface GenPick {
  /** Draw a value from an arbitrary. */
  <T>(arb: Arbitrary<T>): T;
}

/**
 * Imperative-style generator. The provided function receives a `pick` callback
 * that draws values from arbitraries. The function's return value becomes the
 * generated value. Shrinking works by shrinking the individual picks.
 *
 * @example
 * ```ts
 * const point = gen((pick) => ({
 *   x: pick(integer(-100, 100)),
 *   y: pick(integer(-100, 100)),
 * }));
 * ```
 */
export function gen<T>(fn: (pick: GenPick) => T): Arbitrary<T> {
  return function genArb(prng: PRNG, size: number): Tree<T> {
    const picks: Tree<unknown>[] = [];
    const pick: GenPick = <U>(arb: Arbitrary<U>): U => {
      const tree = arb(split(prng), size);
      picks.push(tree as Tree<unknown>);
      return tree.value;
    };
    const value = fn(pick);
    return { value, shrinks: shrinkGen(fn, picks) };
  };
}

function* shrinkGen<T>(fn: (pick: GenPick) => T, picks: Tree<unknown>[]): Iterable<Tree<T>> {
  // Shrink individual picks one at a time
  for (let i = 0; i < picks.length; i++) {
    for (const childTree of picks[i]!.shrinks) {
      const newPicks = picks.slice();
      newPicks[i] = childTree;
      // Re-run fn with the shrunk picks (replay mode)
      let pickIdx = 0;
      try {
        const value = fn(((_arb: Arbitrary<unknown>) => {
          const tree = newPicks[pickIdx++];
          return tree?.value;
        }) as GenPick);
        yield { value, shrinks: shrinkGen(fn, newPicks) };
      } catch {
        // If replaying fails (e.g. different control flow), skip this shrink
      }
    }
  }
}
