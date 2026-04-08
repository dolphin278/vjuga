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

## Additional Principles

These principles complement the core set above. They are drawn from
battle-tested patterns in high-throughput Node.js libraries (Pino, Fastify,
Undici, sonic-boom) and Matteo Collina's engineering methodology.

### 10. Pre-compute at initialization, not per-call

When a computation depends only on configuration known at startup — schemas,
format strings, lookup tables, dispatch maps — generate the specialized
function or data structure **once** during initialization. The hot path should
execute pre-compiled code, not re-derive it on every call.

```ts
// Good: build the lookup once at module load
const flagToString: ReadonlyMap<number, string> = new Map([
  [1, "read"], [2, "write"], [4, "exec"],
]);

// Bad: re-derive the mapping on every call
function flagToStringBad(flag: number): string {
  if (flag === 1) return "read";  // fine for 3 cases, but the principle
  if (flag === 2) return "write"; // scales: pre-compiled validators,
  return "exec";                  // serializers, routers, etc.
}
```

This is the pattern behind `fast-json-stringify` (pre-compiled serializers)
and Fastify's startup-time schema compilation. Move work to initialization
so the hot path pays zero derivation cost.

### 11. Offload non-critical work from hot paths

Operations not on the critical response path — logging, metrics collection,
analytics, serialization for external systems — should be **deferred or
offloaded**:

- `setTimeout(fn, 0)` — next macrotask (used by vjuga's `BufferizedFunction`)
- `queueMicrotask(fn)` — end of current task, before next macrotask
- `worker_threads` — for CPU-heavy processing (logging transports, encoding)

Use the platform's built-in event loop monitoring to measure impact:
- Node.js: `perf_hooks.monitorEventLoopDelay()`, `performance.eventLoopUtilization()`
- Bun: equivalent built-in APIs

Do **not** reinvent event loop monitoring — the platform APIs are
well-optimized and well-maintained.

### 12. Backpressure at producer-consumer boundaries

When one component produces data faster than another consumes it, the
producer must be signaled to slow down. Without backpressure, unbounded
memory growth or data loss occurs.

Patterns:
- Return `false` from write operations to signal "buffer full"
- Use bounded buffers with explicit capacity limits
- Await flush completion before producing more

```ts
// Producer checks return value to know when to pause
const accepted = write(buffer, item);
if (!accepted) {
  // Wait for drain before sending more
  await flush(buffer);
}
```

### 13. Security at parse boundaries

Validate and sanitize at system boundaries where **untrusted data enters**.
Internal code paths between trusted modules need not re-validate.

Specific threats to address at parse boundaries:
- **Prototype pollution**: filter `__proto__` and `constructor` keys from
  parsed JSON (see `safeParse` in `JSON.ts`, inspired by `secure-json-parse`)
- **Schema compliance**: validate before processing, reject early with
  `Result.err()`
- **Input size**: bound input length before parsing to prevent DoS

Do **not** add validation in internal hot paths between trusted modules —
that is wasted CPU. Validate once at the boundary, then trust the result.

---

## GC-Aware Allocation Patterns

V8 uses a **generational garbage collector**:

- **Young generation** (Scavenger): small, fast, collects short-lived objects
  cheaply via copying. Most allocations land here.
- **Old generation** (Mark-Sweep / Mark-Compact): larger, slower, collects
  long-lived objects. Objects that survive multiple Scavenger cycles are
  promoted here.

Implications for hot-path code:

1. **Short-lived temporaries are cheap** — objects allocated and discarded
   within one function call are collected by the Scavenger at near-zero cost.
   Do not contort code to avoid them unless profiling shows GC pressure.

2. **Long-lived mutable objects are expensive to collect** — once promoted to
   old generation, they persist until a Mark-Compact cycle. Pre-allocate and
   reuse them (see `MemoryPool`).

3. **Avoid allocation in tight loops** — each iteration that creates an object
   produces Scavenger work proportional to iteration count. Use pre-allocated
   typed arrays or `MemoryPool.acquire/release` instead.

4. **`WeakRef` + `FinalizationRegistry`** — for caches of expensive objects
   that should not prevent GC. The runtime will clean them up when memory
   pressure rises. Cleanup callbacks are non-deterministic — never rely on
   them for correctness.

```ts
// Good: reuse pool objects in hot loop
for (let i = 0; i < N; i++) {
  const obj = MemoryPool.acquire(pool);
  process(obj);
  MemoryPool.release(pool, obj);
}

// Bad: allocate per iteration — Scavenger runs N times
for (let i = 0; i < N; i++) {
  process({ x: 0, y: 0 }); // N heap objects created and discarded
}
```

---

## Advanced TypeScript Patterns

Beyond the strict-TypeScript basics in principle 8, these patterns are useful
for vjuga's API surface:

### Conditional types for overloaded returns

When a function's return type depends on a type parameter:

```ts
type LookupResult<T, Fallback> =
  Fallback extends undefined ? T | undefined : T;

function get<T, F = undefined>(
  cache: Cache<T>, key: string, fallback?: F
): LookupResult<T, F> { ... }
```

### Template literal types for branded strings

Create branded string subtypes from string literal patterns:

```ts
type EmailAddress = Branded<string, 'EmailAddress'>;
type UUID = Branded<string, 'UUID'>;
```

### `infer` for extracting inner types

Extract the success/error types from `Result`:

```ts
type UnwrapOk<R> = R extends Ok<infer T> ? T : never;
type UnwrapErr<R> = R extends Err<infer E> ? E : never;
```

### Variance annotations

Use `in`/`out` annotations on generic parameters to make variance explicit:

```ts
interface Reader<out T> { read(): T }    // covariant
interface Writer<in T> { write(v: T): void }  // contravariant
```

---

## Common Anti-Patterns

Explicit list of things to **avoid** — each with an explanation of why.

### Do NOT use `Map` for fixed-key lookups

When the set of keys is known at compile time, use a plain object. `Map` has
per-lookup overhead (hashing + bucket chain) that a plain-object property
access avoids — V8 compiles fixed-shape property access to a direct memory
offset load.

### Do NOT create closures inside `for` loops

Each iteration allocates a new closure object on the heap. Capture
loop-invariant references in a local variable before the loop, or use a
module-level helper function.

### Do NOT use recursion in tree traversals on untrusted input

Recursive traversal is bounded by call-stack depth (~10K frames in V8).
Malicious or deeply nested input causes a stack overflow. Use an explicit
stack array instead.

### Do NOT ignore the return value of `Result`

Every `Result<T, E>` must be checked. Discarding the result silently swallows
errors — use the `[0]` discriminant to branch on success/failure.

### Do NOT use `Object.keys()` + `forEach` in hot paths

`Object.keys()` allocates a new array. Use `for...in` with
`Object.hasOwn()` or, better, redesign the data structure to avoid
property enumeration in hot code.

---

## Decision Frameworks

### When to use typed arrays vs plain arrays

```
Is the element type numeric or binary?
  ├─ YES → Use typed array (Int32Array, Float64Array, Uint8Array, etc.)
  │        Choose the narrowest type that fits the domain.
  └─ NO → Is it a hot-path data structure?
           ├─ YES → Use plain Array<T> but pre-allocate capacity.
           │        Avoid push() in tight loops — pre-size and assign by index.
           └─ NO → Use plain Array<T> with standard methods.
```

### When to use SharedArrayBuffer vs postMessage

```
Do multiple Workers need to share the same data?
  ├─ NO → Use postMessage (structured clone). Simple and safe.
  └─ YES → Is the data read-only after initialization?
            ├─ YES → Share the ArrayBuffer, no Atomics needed.
            └─ NO → Can mutations be expressed as single Atomics operations?
                     ├─ YES → Use SharedArrayBuffer + Atomics.
                     └─ NO → Design a lock protocol or reconsider the architecture.
                              Multi-field updates without a lock are a correctness hazard.
```

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
