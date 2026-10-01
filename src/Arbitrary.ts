/**
 * Arbitrary — property-based testing generators with integrated shrinking.
 *
 * Each `Arbitrary<T>` is a function `(prng, size) => Tree<T>` that produces a
 * rose tree: a generated value paired with a lazy, re-iterable collection of
 * progressively simpler shrink candidates. Shrinking is integrated — it
 * composes through `map`, `chain`, `filter`, and all other combinators.
 *
 * When to use: building generators for property-based tests via the Property
 * module. Compose built-in arbitraries (`integer`, `string`, `array`, etc.)
 * with combinators (`map`, `chain`, `filter`, `oneOf`) to describe the shape
 * of your test data. Use `letrec` for recursive structures (JSON, ASTs) and
 * `gen` for imperative-style generation.
 *
 * Internal design:
 *   Tree<T>.value: T — the generated value at this node.
 *   Tree<T>.shrinks: Iterable<Tree<T>> — lazy children; every iteration
 *     re-derives the same children (seeds are captured at generation time).
 *
 * Design tradeoffs: `Iterable` (not `Array`) for shrinks keeps the happy path
 * cheap — children are produced only when the runner traverses during
 * shrinking. Size (0–100, as passed by Property) scales numeric ranges
 * exponentially from the shrink target and reaches the full range at 100.
 *
 * Prior art: Hedgehog (Haskell), fast-check (TypeScript).
 *
 * @example
 * ```ts
 * import * as Arb from "@dolphin278/vjuga/Arbitrary";
 * import * as Prop from "@dolphin278/vjuga/Property";
 * const pairs = Arb.tuple(Arb.integer(-100, 100), Arb.string());
 * Prop.assert(pairs, ([n, s]) => typeof n === "number" && typeof s === "string");
 * ```
 */

import type { Fn1, Predicate } from "./FunctionUtils.js";
import { type PRNG, next, nextInt, nextBigInt, split, make, seed } from "./PRNG.js";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * Rose tree: a value paired with a lazy iterable of shrink candidates.
 * `shrinks` must be re-iterable: iterating it again yields equivalent
 * children (the shrinker and the path replayer iterate it repeatedly).
 * Use an array or `{ [Symbol.iterator]: () => gen() }`, never a bare
 * generator object.
 */
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

/** Size at which numeric arbitraries cover their full declared range. */
const FULL_SIZE = 100;

function leaf<T>(value: T): Tree<T> {
  return { value, shrinks: NO_SHRINKS };
}

/** Wraps a generator factory into a re-iterable (each iteration restarts it). */
function lazy<T>(factory: () => Iterator<Tree<T>>): Iterable<Tree<T>> {
  return { [Symbol.iterator]: factory };
}

/** Fresh PRNG from a seed captured at generation time — deterministic replays. */
function fresh(s: bigint): PRNG {
  return make(seed(s));
}

function mapShrinks<T, U>(shrinks: Iterable<Tree<T>>, fn: Fn1<T, U>): Iterable<Tree<U>> {
  return lazy(function* mapShrinksGen() {
    for (const child of shrinks) {
      yield mapTree(child, fn);
    }
  });
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
    const innerTree = fn(outerTree.value)(prng2, size);
    return {
      value: innerTree.value,
      shrinks: chainShrinks(outerTree, innerTree, fn, nextBigInt(prng2), size),
    };
  };
}

function chainShrinks<T, U>(
  outerTree: Tree<T>,
  innerTree: Tree<U>,
  fn: Fn1<T, Arbitrary<U>>,
  s: bigint,
  size: number,
): Iterable<Tree<U>> {
  return lazy(function* chainShrinksGen() {
    // Phase 1: shrink inner value (keep outer fixed, outer still shrinkable)
    for (const innerShrink of innerTree.shrinks) {
      yield {
        value: innerShrink.value,
        shrinks: chainShrinks(outerTree, innerShrink, fn, s, size),
      };
    }
    // Phase 2: shrink outer value (re-derive inner from a fresh, fixed stream)
    const rng = fresh(s);
    for (const outerShrink of outerTree.shrinks) {
      const childRng = split(rng);
      const newInner = fn(outerShrink.value)(childRng, size);
      yield {
        value: newInner.value,
        shrinks: chainShrinks(outerShrink, newInner, fn, nextBigInt(childRng), size),
      };
    }
  });
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

function filterShrinks<T>(shrinks: Iterable<Tree<T>>, pred: Predicate<T>): Iterable<Tree<T>> {
  return lazy(function* filterShrinksGen() {
    for (const child of shrinks) {
      if (pred(child.value)) {
        yield { value: child.value, shrinks: filterShrinks(child.shrinks, pred) };
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Shrink helpers (internal)
// ---------------------------------------------------------------------------

/**
 * Binary-search shrink toward `target` from `current`.
 * Converges in O(log |current - target|) steps. Uses `Math.trunc` (not `| 0`)
 * so values beyond int32 (timestamps, 2^40, …) stay in range.
 */
function shrinkNumber(target: number, current: number): Iterable<Tree<number>> {
  if (target === current) return NO_SHRINKS;
  return lazy(function* shrinkNumberGen() {
    // Try target directly first
    yield leaf(target);
    // Then binary search
    let lo = target;
    const hi = current;
    while (true) {
      const mid = Math.trunc(lo + (hi - lo) / 2);
      if (mid === lo || mid === hi) break;
      yield { value: mid, shrinks: shrinkNumber(target, mid) };
      lo = mid;
    }
  });
}

/** Binary-search shrink for bigint toward `target` from `current`. */
function shrinkBigInt(target: bigint, current: bigint): Iterable<Tree<bigint>> {
  if (target === current) return NO_SHRINKS;
  return lazy(function* shrinkBigIntGen() {
    yield leaf(target);
    let lo = target;
    const hi = current;
    while (true) {
      const mid = lo + (hi - lo) / 2n;
      if (mid === lo || mid === hi) break;
      yield { value: mid, shrinks: shrinkBigInt(target, mid) };
      lo = mid;
    }
  });
}

/**
 * Shrink an array by removing elements (binary search on length), then
 * shrinking individual elements in place. When `keyFn` is given, every
 * candidate at every depth keeps element keys unique.
 */
function shrinkArray<T>(
  trees: Tree<T>[],
  minLength: number,
  keyFn?: Fn1<T, unknown>,
): Iterable<Tree<T[]>> {
  return lazy(function* shrinkArrayGen() {
    const len = trees.length;
    // Phase 1: remove elements (try halving, then removing one)
    if (len > minLength) {
      for (
        let removeCount = len - minLength;
        removeCount > 0;
        removeCount = (removeCount / 2) | 0
      ) {
        for (let offset = 0; offset < len; offset += removeCount) {
          const candidate = [...trees.slice(0, offset), ...trees.slice(offset + removeCount)];
          if (candidate.length >= minLength) {
            // Removing elements never introduces duplicates.
            yield {
              value: candidate.map((t) => t.value),
              shrinks: shrinkArray(candidate, minLength, keyFn),
            };
          }
        }
        if (removeCount === 1) break;
      }
    }
    // Phase 2: shrink individual elements
    for (let i = 0; i < len; i++) {
      for (const childTree of trees[i]!.shrinks) {
        const copy = trees.slice();
        copy[i] = childTree;
        const value = copy.map((t) => t.value);
        if (keyFn !== undefined && !allUnique(value, keyFn)) continue;
        yield { value, shrinks: shrinkArray(copy, minLength, keyFn) };
      }
    }
  });
}

function allUnique<T>(values: T[], keyFn: Fn1<T, unknown>): boolean {
  const seen = new Set<unknown>();
  for (const v of values) {
    const k = keyFn(v);
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

/**
 * Half-width of the sized range on one side of the shrink target. Grows
 * exponentially with `size` (never narrower than `size` itself) and covers
 * the full `span` once `size >= FULL_SIZE`.
 */
function sizedWidth(span: number, size: number): number {
  if (size >= FULL_SIZE) return span;
  const s = Math.max(0, Math.floor(size));
  const exp = Math.floor(Math.pow(span + 1, s / FULL_SIZE)) - 1;
  return Math.min(span, Math.max(s, exp));
}

/** Uniform integer in [lo, hi]; exact even when the range exceeds 2^53. */
function drawInt(prng: PRNG, lo: number, hi: number): number {
  if (hi - lo < Number.MAX_SAFE_INTEGER) return nextInt(prng, lo, hi);
  const range = BigInt(hi) - BigInt(lo) + 1n;
  return Number(BigInt(lo) + (nextBigInt(prng) % range));
}

function sizedWidthBig(span: bigint, size: number): bigint {
  if (size >= FULL_SIZE) return span;
  const s = Math.max(0, Math.floor(size));
  const exp = Math.pow(Number(span) + 1, s / FULL_SIZE);
  const w = Number.isFinite(exp) ? BigInt(Math.floor(exp)) - 1n : span;
  const sN = BigInt(s);
  const atLeast = w > sN ? w : sN;
  return atLeast < span ? atLeast : span;
}

/** Uniform bigint in [lo, hi], drawing as many 64-bit words as the range needs. */
function drawBigInt(prng: PRNG, lo: bigint, hi: bigint): bigint {
  const range = hi - lo + 1n;
  let raw = nextBigInt(prng);
  // Keep >= 64 bits of slack above the range so modulo bias stays negligible.
  for (let bound = 1n << 64n; bound < range << 64n; bound <<= 64n) {
    raw = (raw << 64n) | nextBigInt(prng);
  }
  return lo + (raw % range);
}

// ---------------------------------------------------------------------------
// Built-in arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates integers in [min, max] (inclusive). Shrinks toward 0 (or the
 * nearest bound if 0 is outside the range).
 *
 * Sizing: at small sizes values cluster around the shrink target; the window
 * widens exponentially and spans the whole [min, max] at size >= 100.
 * Throws `RangeError` unless both bounds are safe integers with min <= max.
 */
export function integer(min = -0x7fff_ffff, max = 0x7fff_ffff): Arbitrary<number> {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
    throw new RangeError(
      `integer: bounds must be safe integers with min <= max (got ${min}, ${max})`,
    );
  }
  const target = min <= 0 && max >= 0 ? 0 : min > 0 ? min : max;
  const down = target - min;
  const up = max - target;
  return function integerArb(prng: PRNG, size: number): Tree<number> {
    const value = drawInt(prng, target - sizedWidth(down, size), target + sizedWidth(up, size));
    return { value, shrinks: shrinkNumber(target, value) };
  };
}

/** Generates non-negative integers in [0, max]. Shrinks toward 0. */
export function nat(max = 0x7fff_ffff): Arbitrary<number> {
  return integer(0, max);
}

/**
 * Generates floating-point numbers in [min, max). Shrinks toward 0 (or the
 * in-range value nearest to 0); shrink candidates never leave the range.
 * Throws `RangeError` unless both bounds are finite with min <= max.
 */
export function float(min = -1e10, max = 1e10): Arbitrary<number> {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new RangeError(`float: bounds must be finite with min <= max (got ${min}, ${max})`);
  }
  const target = min <= 0 && max > 0 ? 0 : min > 0 || min === max ? min : max;
  return function floatArb(prng: PRNG, _size: number): Tree<number> {
    const value = min + next(prng) * (max - min);
    return { value, shrinks: shrinkFloat(target, value, min, max) };
  };
}

function shrinkFloat(
  target: number,
  current: number,
  min: number,
  max: number,
): Iterable<Tree<number>> {
  if (target === current) return NO_SHRINKS;
  const inRange = (x: number) => x === min || (x > min && x < max);
  return lazy(function* shrinkFloatGen() {
    if (inRange(target)) yield leaf(target);
    // Try truncating to integer
    const truncated = Math.trunc(current);
    if (truncated !== current && truncated !== target && inRange(truncated)) {
      yield { value: truncated, shrinks: shrinkFloat(target, truncated, min, max) };
    }
    // Binary search
    let lo = target;
    const hi = current;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (mid === lo || mid === hi) break;
      if (inRange(mid)) yield { value: mid, shrinks: shrinkFloat(target, mid, min, max) };
      lo = mid;
    }
  });
}

/** Generates booleans. Shrinks toward false. */
export function boolean(): Arbitrary<boolean> {
  const falseTree = leaf(false);
  const trueTree: Tree<boolean> = { value: true, shrinks: [falseTree] };
  return function booleanArb(prng: PRNG, _size: number): Tree<boolean> {
    return next(prng) < 0.5 ? trueTree : falseTree;
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
 * characters (down to `minLength`), then by replacing characters with 'a'.
 */
export function string(opts?: { minLength?: number; maxLength?: number }): Arbitrary<string> {
  /* node:coverage ignore next */
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

function shrinkString(current: string, minLength: number): Iterable<Tree<string>> {
  return lazy(function* shrinkStringGen() {
    if (current.length > minLength) {
      // Try empty string
      if (minLength === 0) yield leaf("");
      // Remove one character (from the end); the shrinker recurses for more.
      const i = current.length - 1;
      const shorter = current.slice(0, i) + current.slice(i + 1);
      yield { value: shorter, shrinks: shrinkString(shorter, minLength) };
    }
    // Simplify the first non-'a' character toward 'a'
    for (let i = 0; i < current.length; i++) {
      if (current[i] !== "a") {
        const simplified = current.slice(0, i) + "a" + current.slice(i + 1);
        yield { value: simplified, shrinks: shrinkString(simplified, minLength) };
        break;
      }
    }
  });
}

/**
 * Generates arrays of values from `arb`. Shrinks by removing elements, then
 * shrinking individual elements.
 */
export function array<T>(
  arb: Arbitrary<T>,
  opts?: { minLength?: number; maxLength?: number },
): Arbitrary<T[]> {
  /* node:coverage ignore next */
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

function shrinkTuple(trees: Tree<unknown>[]): Iterable<Tree<unknown[]>> {
  return lazy(function* shrinkTupleGen() {
    for (let i = 0; i < trees.length; i++) {
      for (const childTree of trees[i]!.shrinks) {
        const copy = trees.slice();
        copy[i] = childTree;
        yield { value: copy.map((t) => t.value), shrinks: shrinkTuple(copy) };
      }
    }
  });
}

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

function shrinkRecord(pairs: [string, Tree<unknown>][]): Iterable<Tree<Record<string, unknown>>> {
  return lazy(function* shrinkRecordGen() {
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
  });
}

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
      shrinks: alternativeShrinks(tree, arbs, idx, nextBigInt(prng), size),
    };
  };
}

/**
 * Children of a choice node: the chosen tree's own shrinks, then a fresh value
 * from each of `alternatives[0..count)` drawn from a fixed captured seed.
 */
function alternativeShrinks<T>(
  tree: Tree<T>,
  alternatives: Arbitrary<T>[],
  count: number,
  s: bigint,
  size: number,
): Iterable<Tree<T>> {
  return lazy(function* alternativeShrinksGen() {
    yield* tree.shrinks;
    const rng = fresh(s);
    for (let i = 0; i < count; i++) {
      yield alternatives[i]!(split(rng), size);
    }
  });
}

// ---------------------------------------------------------------------------
// Extended arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates bigints in [min, max] (inclusive). Shrinks toward 0n (or the
 * nearest bound). Sized like `integer`: full range at size >= 100.
 * Throws `RangeError` when min > max.
 */
export function bigint(
  min = -0x7fff_ffff_ffff_ffffn,
  max = 0x7fff_ffff_ffff_ffffn,
): Arbitrary<bigint> {
  if (min > max) throw new RangeError(`bigint: min must be <= max (got ${min}, ${max})`);
  const target = min <= 0n && max >= 0n ? 0n : min > 0n ? min : max;
  const down = target - min;
  const up = max - target;
  return function bigintArb(prng: PRNG, size: number): Tree<bigint> {
    const value = drawBigInt(
      prng,
      target - sizedWidthBig(down, size),
      target + sizedWidthBig(up, size),
    );
    return { value, shrinks: shrinkBigInt(target, value) };
  };
}

/**
 * Generates Date objects in [min, max]. Shrinks toward the Unix epoch (or the
 * nearest bound). Sized like `integer` over epoch milliseconds.
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
 * Shrinks by removing elements, then shrinking individual elements; every
 * shrink candidate stays unique. On key collisions the element generator is
 * retried at growing sizes (up to 100); throws if `minLength` unique elements
 * still cannot be produced.
 */
export function uniqueArray<T>(
  arb: Arbitrary<T>,
  opts?: { minLength?: number; maxLength?: number; key?: Fn1<T, unknown> },
): Arbitrary<T[]> {
  /* node:coverage ignore next 3 */
  const minLen = opts?.minLength ?? 0;
  const maxLen = opts?.maxLength ?? 10;
  const keyFn = opts?.key ?? ((x: T) => x);
  return function uniqueArrayArb(prng: PRNG, size: number): Tree<T[]> {
    const sizedMax = Math.min(maxLen, Math.max(minLen, size));
    const targetLen = nextInt(prng, minLen, sizedMax);
    const trees: Tree<T>[] = [];
    const seen = new Set<unknown>();
    const sizeCap = Math.max(size, FULL_SIZE);
    let genSize = size;
    let misses = 0;
    while (trees.length < targetLen) {
      const tree = arb(split(prng), genSize);
      const k = keyFn(tree.value);
      if (!seen.has(k)) {
        seen.add(k);
        trees.push(tree);
        misses = 0;
      } else if (++misses >= 10) {
        if (genSize >= sizeCap) break;
        genSize = Math.min(sizeCap, Math.max(1, genSize * 2));
        misses = 0;
      }
    }
    if (trees.length < minLen) {
      throw new Error(
        `uniqueArray: only ${trees.length} unique element(s) found, minLength is ${minLen}`,
      );
    }
    return {
      value: trees.map((t) => t.value),
      shrinks: shrinkArray(trees, minLen, keyFn),
    };
  };
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
    /* node:coverage ignore next 2 */
    minLength: opts?.minSize ?? 0,
    maxLength: opts?.maxSize ?? 10,
    key: ([k]) => k,
  });
  return map(arrArb, (pairs) => Object.fromEntries(pairs) as Record<string, V>);
}

/**
 * Weighted choice among arbitraries. Each entry is `{ weight, arb }`.
 * Higher weight = more likely to be chosen; weight 0 disables an entry.
 * Shrinks within the chosen arbitrary, then toward strictly higher-priority
 * (higher weight, then earlier) entries. Throws `RangeError` on a negative or
 * non-finite weight, or when all weights are 0.
 */
export function frequency<T>(
  ...entries: [{ weight: number; arb: Arbitrary<T> }, ...{ weight: number; arb: Arbitrary<T> }[]]
): Arbitrary<T> {
  let totalWeight = 0;
  for (const e of entries) {
    if (!Number.isFinite(e.weight) || e.weight < 0) {
      throw new RangeError(`frequency: weights must be finite and >= 0 (got ${e.weight})`);
    }
    totalWeight += e.weight;
  }
  if (totalWeight <= 0) throw new RangeError("frequency: at least one weight must be > 0");
  // Shrink priority: positive-weight entries by weight descending (stable).
  const order = entries
    .map((_, i) => i)
    .filter((i) => entries[i]!.weight > 0)
    .sort((a, b) => entries[b]!.weight - entries[a]!.weight);
  const ranked = order.map((i) => entries[i]!.arb);
  const rank = new Map(order.map((entryIdx, r) => [entryIdx, r]));
  const lastPositive = order.reduce((a, b) => (a > b ? a : b));
  return function frequencyArb(prng: PRNG, size: number): Tree<T> {
    const r = next(prng) * totalWeight;
    let cumulative = 0;
    // Fallback guards against float rounding leaving r >= the final sum.
    let chosen = lastPositive;
    for (let i = 0; i < entries.length; i++) {
      cumulative += entries[i]!.weight;
      if (r < cumulative) {
        chosen = i;
        break;
      }
    }
    const tree = entries[chosen]!.arb(split(prng), size);
    const position = rank.get(chosen)!;
    if (position === 0) return tree;
    return {
      value: tree.value,
      shrinks: alternativeShrinks(tree, ranked, position, nextBigInt(prng), size),
    };
  };
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
    return { value, shrinks: shrinkSubarray(value) };
  };
}

function shrinkSubarray<T>(current: T[]): Iterable<Tree<T[]>> {
  if (current.length === 0) return NO_SHRINKS;
  return lazy(function* shrinkSubarrayGen() {
    // Try empty
    yield leaf([]);
    // Remove elements one at a time
    for (let i = current.length - 1; i >= 0; i--) {
      const shorter = [...current.slice(0, i), ...current.slice(i + 1)];
      yield { value: shorter, shrinks: shrinkSubarray(shorter) };
    }
  });
}

// ---------------------------------------------------------------------------
// Advanced combinators
// ---------------------------------------------------------------------------

/**
 * Defines mutually recursive arbitraries. The `tie` function receives a
 * lazy reference that can be used in generator definitions before they exist.
 *
 * Termination: one top-level generation shares a budget of `size` recursive
 * expansions; each `tie(...)` reference consumes one and is generated at
 * `size - 1`, and once the budget is spent references are generated at size 0.
 * With the default `array` (≤ 10 elements) the example below therefore yields
 * at most ~10·(size + 1) nodes. References still recurse at size 0, so the
 * shape must have a size-0 base case (e.g. an empty `array`).
 *
 * @example
 * ```ts
 * const { json } = letrec((tie) => ({
 *   json: oneOf<unknown>(integer(), string(), array(tie("json"))),
 * }));
 * ```
 */
export function letrec<Shape extends Record<string, Arbitrary<unknown>>>(
  tie: (ref: (name: keyof Shape & string) => Arbitrary<unknown>) => Shape,
): Shape {
  const cache = new Map<string, Arbitrary<unknown>>();
  // Shared expansion budget for the outermost in-flight generation.
  let active = false;
  let remaining = 0;
  const withBudget = (arb: Arbitrary<unknown>, prng: PRNG, size: number): Tree<unknown> => {
    if (active) return arb(prng, size);
    active = true;
    remaining = size;
    try {
      return arb(prng, size);
    } finally {
      active = false;
    }
  };
  const ref = (name: string): Arbitrary<unknown> => {
    return function lazyArb(prng: PRNG, size: number): Tree<unknown> {
      const resolved = cache.get(name);
      /* node:coverage ignore next 2 */
      if (!resolved) throw new Error(`letrec: unresolved reference "${name}"`);
      // Entered outside a generation (e.g. re-derived during shrinking):
      // start a fresh, bounded budget.
      if (!active) return withBudget(lazyArb, prng, size);
      if (remaining <= 0) return resolved(prng, 0);
      remaining--;
      return resolved(prng, Math.max(0, size - 1));
    };
  };
  const shape = tie(ref);
  const out: Record<string, Arbitrary<unknown>> = {};
  for (const [name, arb] of Object.entries(shape)) {
    cache.set(name, arb);
    out[name] = function letrecArb(prng: PRNG, size: number): Tree<unknown> {
      return withBudget(arb, prng, size);
    };
  }
  return out as Shape;
}

/**
 * Callback passed to `gen()` — allows imperative-style generation by drawing
 * values from arbitraries inline.
 */
export interface GenPick {
  /** Draw a value from an arbitrary. */
  <T>(arb: Arbitrary<T>): T;
}

interface Pick {
  readonly arb: Arbitrary<unknown>;
  readonly tree: Tree<unknown>;
}

/**
 * Imperative-style generator. The provided function receives a `pick` callback
 * that draws values from arbitraries. The function's return value becomes the
 * generated value. Shrinking works by shrinking the individual picks.
 *
 * Replay: when a shrunk pick changes control flow, a recorded pick is reused
 * only if it was drawn from the same arbitrary (same reference, or same
 * function name and source — so two `map(...)` arbs are indistinguishable).
 * From the first mismatch on, picks are drawn fresh at size 0.
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
    const picks: Pick[] = [];
    const pick: GenPick = <U>(arb: Arbitrary<U>): U => {
      const tree = arb(split(prng), size);
      picks.push({ arb: arb as Arbitrary<unknown>, tree: tree as Tree<unknown> });
      return tree.value;
    };
    const value = fn(pick);
    return { value, shrinks: shrinkGen(fn, picks) };
  };
}

function sameArb(a: Arbitrary<unknown>, b: Arbitrary<unknown>): boolean {
  return a === b || (a.name === b.name && a.toString() === b.toString());
}

function shrinkGen<T>(fn: (pick: GenPick) => T, picks: Pick[]): Iterable<Tree<T>> {
  return lazy(function* shrinkGenGen() {
    // Shrink individual picks one at a time
    for (let i = 0; i < picks.length; i++) {
      for (const childTree of picks[i]!.tree.shrinks) {
        const candidate = picks.slice();
        candidate[i] = { arb: picks[i]!.arb, tree: childTree };
        const replayed = replayGen(fn, candidate);
        if (replayed !== undefined) yield replayed;
      }
    }
  });
}

/** Re-runs `fn` against recorded picks; undefined if `fn` throws. */
function replayGen<T>(fn: (pick: GenPick) => T, recorded: Pick[]): Tree<T> | undefined {
  const used: Pick[] = [];
  let diverged = false;
  let fallback: PRNG | undefined;
  const pick = ((arb: Arbitrary<unknown>) => {
    const rec = recorded[used.length];
    if (!diverged && rec !== undefined && sameArb(rec.arb, arb)) {
      used.push(rec);
      return rec.tree.value;
    }
    diverged = true;
    fallback ??= fresh(0n);
    const tree = arb(split(fallback), 0);
    used.push({ arb, tree });
    return tree.value;
  }) as GenPick;
  let value: T;
  try {
    value = fn(pick);
  } catch {
    // Replaying failed (e.g. invalid combination of picks) — skip this shrink
    return undefined;
  }
  return { value, shrinks: shrinkGen(fn, used) };
}
