---
name: vjuga-code
description: >
  Authors high-quality, performance-first TypeScript/JavaScript code in the
  vjuga style: JIT-aware monomorphic design, tuple-based Result<T,E>, branded
  types, free-floating functions with unique-symbol private fields, and 100%
  test coverage. Applies to any modern JS/TS codebase that shares these goals.
  Invoke when writing or reviewing any code in this repository.
---

You are writing code for **vjuga**, a zero-dependency, ESM-only TypeScript
utility library where every decision is evaluated against real JIT compiler
behavior — not just language correctness or abstract cleanliness. The code
must be readable, provably correct, and ruthlessly fast.

---

## Core Principles

These principles are load-bearing. Reason from them to reach correct behavior
on cases not explicitly listed below.

### 1. Monomorphism is the performance contract

Modern JavaScript JIT compilers (V8/TurboFan, JSC/FTL, SpiderMonkey/Ion)
generate optimal code for *monomorphic* call sites — sites that always receive
values of the same hidden class (shape). A call site that sees two shapes is
*polymorphic*; three or more is *megamorphic* (no inline cache at all).

To enforce monomorphism:

- **Use factory functions, not classes, for hot-path objects.** Classes create
  new hidden classes when properties are added in different orders. A single
  factory function that always builds the same shape guarantees monomorphism
  across all instances.
- **Dispatch with free-floating functions.** `push(queue, v)` is always called
  with the same argument types, keeping the call site in a monomorphic IC.
  `queue.push(v)` is a property lookup that may be overridden, preventing IC
  specialization.
- **Private fields use `unique symbol` keys** declared at module scope. Symbol
  keys are unambiguous (no prototype collision), keep the object shape stable,
  and are compiled to integer slot offsets by the JIT. Using a string property
  name like `"_head"` creates ambiguity and may degrade to a dictionary lookup.

```ts
// Declare at module scope — one symbol, one shape across all instances
const kHead: unique symbol = Symbol('head');
const kTail: unique symbol = Symbol('tail');

export interface Queue<T> {
  [kHead]: number;
  [kTail]: number;
}

export function make<T>(): Queue<T> {
  return { [kHead]: 0, [kTail]: 0 };
}

// Free-floating functions — call site always sees the same arg shapes
export function size<T>(q: Queue<T>): number {
  return (q[kTail] - q[kHead] + ...) & ...;
}
```

### 2. Write mutable fields twice at construction time

When a field will be mutated after the object is first created, JIT compilers
may initially classify it as a *constant* and constant-fold reads. The first
write after construction triggers a *deoptimization cascade* that recompiles
every function that touched the object. Writing the field a second time in the
factory function forces the compiler to classify it as mutable from the very
first construction — no cascade ever fires.

Apply this pattern to **every field that is written to outside the initial
object literal**: counters, pointers, capacity masks, size trackers.

```ts
export function make<T>(capacity: number): Pool<T> {
  const pool: Pool<T> = { [kSize]: 0, [kCapacity]: capacity, [kItems]: [] };
  pool[kSize] = 0; // Force JIT to treat kSize as mutable from first construction.
  //               Without this, the first release() write triggers a deopt
  //               cascade on every compiled Pool function.
  return pool;
}
```

### 3. Result<T, E> is a readonly tuple — the discriminant is index 0

The library's `Result<T, E>` is defined as:
```ts
type Ok<T>  = readonly [true, T];
type Err<E> = readonly [false, E];
type Result<T, E> = Ok<T> | Err<E>;
```

Integer-index access (`result[0]`, `result[1]`) is faster than named-property
access. The boolean discriminant at index 0 is a Smi literal that JIT compilers
constant-fold at specialized call sites. The shape is always `[boolean, value]`
regardless of `T` or `E`, keeping every call site monomorphic.

Never represent failure as a thrown exception for recoverable conditions. Return
`Result.err(...)` instead. Use `Result.fromThrowable` and `Result.fromPromise`
to wrap APIs that throw.

```ts
import * as Result from '../Result.js';

function divide(a: number, b: number): Result.Result<number, string> {
  if (b === 0) return Result.err('division by zero');
  return Result.ok(a / b);
}

// At the call site — discriminant check stays monomorphic
const r = divide(10, x);
if (r[0]) {
  console.log(r[1]); // number
} else {
  console.error(r[1]); // string
}
```

### 4. No closures in hot paths

Closures capture their lexical scope, allocate a heap object per creation, and
can block inlining across closure boundaries. In hot code:

- Capture loop-invariant references in local variables before the loop rather
  than letting the closure re-read them through the scope chain.
- Use `Reflect.apply(fn, thisArg, args)` when `this` must be provided —
  `Reflect.apply` is a single generic call shape that stays monomorphic
  regardless of `fn`'s arity, unlike `fn.call(ctx, a, b, c)` which varies.
- Use arity-specialized `switch` cases with captured variables to eliminate
  per-call dispatch overhead:

```ts
switch (fns.length) {
  case 2: {
    const f0 = fns[0]; // captured once — no re-read inside returned closure
    const f1 = fns[1];
    return (...x) => f1(f0(...x));
  }
  // ...
  default:
    return variadicFallback(fns); // extracted to named fn — avoids Bun
    //                             coverage-marking bug on {} blocks in switch
}
```

### 5. Loops over array higher-order methods in hot paths

`Array.prototype.map`, `filter`, and `reduce` pass lambdas that JIT compilers
may not inline, and each call produces an intermediate array. In hot or
frequently-called code, write `for` loops. Add a comment when this substitution
is non-obvious to a reader.

Higher-order methods are fine for initialization, configuration, and code that
is not on the hot path.

### 6. Typed arrays for numeric and binary data — SharedArrayBuffer for concurrency

Typed arrays (`Int32Array`, `Uint32Array`, `Float64Array`, `Uint8Array`, etc.)
store values in contiguous, unboxed memory. They are appropriate wherever the
element type maps cleanly to a numeric or binary representation — not only for
integers. Choose the narrowest typed array that accurately represents the
domain (e.g., `Float64Array` for timestamps or weights, `Uint8Array` for byte
buffers, `Int32Array` for linked-list slot indices).

Benefits over `Array<number>`:
- No boxing/unboxing overhead — values are stored as raw numbers.
- Contiguous memory layout — better CPU cache utilization.
- Reduced GC pressure — the buffer is one large allocation, not N small ones.
- Direct `ArrayBuffer` access enables zero-copy transfer and sharing.

**Multi-core and shared-memory concurrency.** When data must be shared across
Workers without serialization overhead, back the typed array with a
`SharedArrayBuffer`. Use `Atomics` operations (`Atomics.load`, `Atomics.store`,
`Atomics.add`, `Atomics.compareExchange`, `Atomics.wait`/`Atomics.waitAsync`)
for all accesses to shared state to avoid data races. Document the memory
ordering assumptions with each `Atomics` call — `Atomics` provides
sequentially-consistent ordering for individual operations but not for
multi-step sequences without explicit coordination.

```ts
// Shared ring-buffer header: [head, tail, capacity] — one Int32Array per worker
const header = new Int32Array(new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT));
Atomics.store(header, 0, 0); // head
Atomics.store(header, 1, 0); // tail
Atomics.store(header, 2, N); // capacity
```

Consider `SharedArrayBuffer` when:
- Multiple Workers produce or consume the same data structure.
- Serialization cost via `postMessage` is measurable (profile first).
- The data structure's mutation protocol can be expressed via `Atomics`.

Do not use `SharedArrayBuffer` for structures that require non-atomic
multi-field updates without a clear lock or lock-free protocol — that is a
correctness hazard.

### 7. Document every performance trade-off

An optimization without a comment explaining *why* will be removed by the next
contributor as "unnecessary complexity." Every unusual pattern — double-write,
`Reflect.apply`, typed array, loop-instead-of-map, switch-unroll,
SharedArrayBuffer, Atomics — **must** carry a comment that:
1. States the JIT behavior being exploited or avoided.
2. Describes what breaks without it (deopt cascade, megamorphic IC, etc.).
3. Names the specific case where this matters.

The *what* is the code. The comment explains the *why*.

### 8. Strict TypeScript with no escape hatches

- `strict: true` with `isolatedModules: true` and `verbatimModuleSyntax: true`.
- No `any`. Narrow `unknown` at boundaries before using.
- No non-null assertions (`!`) unless the invariant cannot be expressed as a
  type — if used, a comment must state why it holds.
- Use `Branded<Base, Kind>` (from `FunctionUtils.ts`) for domain primitives
  that must not mix with plain strings or numbers.
- All imports use the compiled filename extension (`.js` for TypeScript files
  that compile to `.js`). `verbatimModuleSyntax` enforces this; any import
  that uses `.ts` will fail at runtime.
- Only erasable TypeScript syntax — no decorators, no `const enum`, no
  runtime-affecting type constructs.

### 9. Follow the existing module's shape when extending

When adding to an existing module, use its established `unique symbol` names,
factory function name, and helper function naming conventions exactly. Do not
introduce a second symbol scheme or a new object shape for the same concept.
Consistency is what keeps call sites monomorphic across the entire module
boundary — two different shapes for "a queue" is two polymorphic hot paths.

---

## Authoring a New Module

1. **Types and public API first.** Write the interface, exported types, and
   function signatures before any implementation. The types are the contract.

2. **Private state via module-scope unique symbols.** One symbol per internal
   field. Names should be descriptive (`kHead`, `kCapacityMask`, `kFreeList`).

3. **Factory function** (conventionally `make()`). Always produces the exact
   same object shape. Apply the double-write pattern to every field that will
   be mutated outside the object literal.

4. **Free-floating operation functions** with signature `(structure, ...args)`.
   Keep argument types consistent across all functions so the JIT sees one
   shape throughout the module.

5. **Result types for fallible operations.** Throw only for programmer errors
   (invalid arguments at construction) using `RangeError` or `TypeError`.
   Everything else returns `Result<T, E>`.

6. **Private module-level helpers** for repeated internal operations (e.g.,
   `detach`, `insertAfterSentinel`). Not exported, not closures — keep them
   at module scope so the JIT can inline them.

---

## Testing

Tests must achieve **100% coverage** — branches, statements, functions, and
lines. Coverage is enforced by the project's CI gate; partial coverage is a
build failure.

Coverage rules:
- Test every code branch: each conditional, each early return, every fallible
  path, capacity boundaries (N=0, N=1, at-capacity, over-capacity).
- Use `/* c8 ignore next */` **only** for platform-specific code that cannot
  be exercised in the current runtime (e.g., a Bun-only path when running
  under Node.js, or vice versa). Always add a same-line comment stating why.
- Test `Result`-returning functions by checking `result[0]` (the discriminant)
  and `result[1]` (the payload) directly — this also tests the monomorphic
  return shape.
- For concurrent code using `SharedArrayBuffer`, test both single-threaded
  behavior (deterministic) and, where possible, concurrent access patterns
  using multiple Workers.

Structure:
- Tests live adjacent to source in `src/tests/` and share the module's naming.
- Use the project's configured test runner and assertion library.
- Group related operation families with `describe`; use flat `test()` for
  small focused modules.
- No external test framework dependencies.

---

## Benchmarking

Benchmarks are required for:
- Every new data structure.
- Every function called in a tight loop.
- Any change to an existing hot-path function.

A benchmark that runs without a warm-up phase measures interpreter performance,
not JIT-compiled performance. Always warm up the code under test for at least
10,000–100,000 iterations before taking measurements.

```ts
// Warm-up — let the JIT compile and specialize before we measure
{
  const s = MyModule.make();
  for (let i = 0; i < 100_000; i++) {
    MyModule.push(s, i);
    MyModule.pop(s);
  }
}

// Benchmarks cover each operation family and boundary condition
bench('push (warm, non-resizing)', () => { ... });
bench('push (triggers resize)', () => { ... });
bench('pop (empty)', () => { ... });
```

For changes to existing hot-path code, capture before/after numbers and
include them in the commit message. A regression requires an explicit comment
explaining the acceptable trade-off.

---

## CPU and Memory Profiling

**Profiling is mandatory after every change to a hot-path function or data
structure.** Benchmarks confirm throughput; profiling confirms *why* the
numbers are what they are and catches regressions that aggregate benchmarks
can hide.

### CPU profiling

Use the VM's built-in profiler to verify that JIT compilation is taking the
expected path:

- **V8 (Node.js)**: Run with `--prof` to generate an isolate log, then process
  with `node --prof-process`. Check that hot functions are compiled by
  TurboFan/Maglev (not running in Ignition/Sparkplug). Use
  `--allow-natives-syntax` with `%GetOptimizationStatus(fn)` or
  `%OptimizeFunctionOnNextCall(fn)` to assert compilation tier in tests.
- **Bun**: Use `bun:jsc` intrinsics (`numberOfDFGCompiles`,
  `optimizeNextInvocation`) to verify DFG/FTL compilation after warm-up.
- **General**: Look for unexpected deoptimization entries in profiler output.
  A function that deoptimizes on every call negates all monomorphism work.

What to check after every hot-path change:
1. The function reaches the top JIT tier after warm-up.
2. No unexpected deoptimization events appear in the profile.
3. Call sites into the changed function remain monomorphic (IC hit rate ≥ 99%).

### Memory profiling

Heap allocations in hot paths are a latency tax — the GC will collect them.
After every hot-path change:

1. **Measure allocation rate.** Force GC before and after a fixed number of
   operations; compare heap deltas. A function that allocates per-call shows a
   linear heap delta; a zero-allocation design shows near-zero delta.
2. **Check for unintentional closures.** A closure created inside a loop
   allocates a new heap object each iteration.
3. **Validate typed-array choices.** If a data structure switches from
   `Array<number>` to a typed array, verify the heap delta improves.

```ts
const gc = () => {
  if (typeof Bun !== 'undefined') Bun.gc(true);
  // Node.js: run with --expose-gc, then call global.gc()
};

gc();
const before = process.memoryUsage().heapUsed;
for (let i = 0; i < N; i++) { hotFunction(args); }
gc();
const after = process.memoryUsage().heapUsed;
console.log(`heap delta per op: ${((after - before) / N).toFixed(1)} bytes`);
```

Any change that increases allocation rate by more than 5% relative to the
baseline **must** be justified with a comment explaining why the trade-off is
acceptable.

---

## Error Types

Custom errors extend the platform `Error` class, set `this.name`, and chain
causes via the standard `.cause` field:

```ts
export class MyError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = 'MyError';
  }
}
```

Error hierarchies stay flat — no more than one level of subclassing.

---

## Pre-ship Checklist

Before any code is considered complete:

- [ ] All private state uses module-scope `unique symbol` keys
- [ ] `make()` double-writes every field that will be mutated post-construction
- [ ] All fallible public operations return `Result<T, E>`, not throw
- [ ] Typed arrays used for all numeric/binary fields in data structures; `SharedArrayBuffer` + `Atomics` for cross-Worker shared state
- [ ] Hot-path functions use explicit loops, not `map`/`filter`/`reduce`
- [ ] Every performance optimization has a comment explaining the JIT reason
- [ ] All imports use the compiled file extension (e.g., `.js`)
- [ ] No `any`, no unexplained non-null assertions
- [ ] Coverage gate passes at 100% on all metrics
- [ ] Benchmarks written and warm-up verified
- [ ] CPU profiling confirms hot functions reach top JIT tier, no unexpected deoptimizations
- [ ] Memory profiling confirms no unexpected allocation regression (≤5% delta)
- [ ] Linter and formatter pass cleanly
