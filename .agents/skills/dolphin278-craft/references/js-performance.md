# Target runtimes

- Node.js LTS
- Bun.sh
- Modern evergreen browsers (Chrome, Firefox, Safari, Edge)

# Performance orientation

Code should be optimized with performance according to recent developments in
most popular JavaScript engines.

## Monomorphic code patterns should be preferred over polymorphic ones

In the order of importance:

1. Avoid polymorphism - use monomorphic code patterns whenever possible.
2. Avoid megamorphic code patterns - if polymorphism is necessary, try to limit
   the number of different shapes to a minimum.
3. Avoid polymorphic code patterns in hot code paths - if polymorphism is
   necessary, try to avoid it in hot code paths.

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

## Pay attention to if code is optimized by JavaScript engines

Chrome DevTools, Node --perf and other profiling tools can be used to check if
code is optimized by JavaScript engines.

Benchmarks should be designed in a way that they will resemble real-world usage
to detect possible polymorphic code patterns.

## Same shape objects is not enough

Even if objects have the same shape, they can still be polymorphic if they are
created in different places in the code. To avoid this, factory functions should
be used consistently to create objects of the same prototype.

## Avoid long prototype chains

Walking up the prototype chain is expensive, so it's important to avoid them.

## Avoid using classes

Classes can introduce polymorphism and megamorphism, so it's generally better to
use factory functions and plain objects instead.

Classes can be used when they are required by external APIs or to subclass Error
class.

Prefer free-floating functions and plain objects over classes.

## Avoid dynamic dispatch

In general, try to avoid object.method calls and dynamic dispatch, as they can
lead to polymorphism. Instead, use free-floating functions that take objects as
arguments. This can help ensure that the code remains monomorphic and optimized
by JavaScript engines.

Instead of `obj1.obj2.obj3.method(...args)`, do:

```ts
   const fn = obj1.obj2.obj3.method;

   // ...

   fn(...args) // if function is free-floating, or

   fn.call(obj1.obj2.obj3, ...args) // if function needs `this` context
```

Such replaces require profiling to prove that they do not make performance worse.

## Write mutable fields twice at construction time

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

## Be mindful about capturing variables in closures

Having large values in closures can lead to memory leaks and performance issues.
Oftentimes we can define function at the top level and use `.call()` or
`.bind()`.

## Avoid creating closures in hot code paths

Creating closures in hot code paths can lead to performance issues, as it can
lead to increased memory usage and garbage collection overhead. If a closure is
necessary, try to create it outside of the hot code path and reuse it whenever
possible.

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

## Prefer loops over functional methods like `map`, `filter`, `reduce`

Their lambdas sometimes are not inlined, and they can lead to increased memory
usage due to creating intermediate arrays and closures. In hot code paths, it's
often better to use traditional loops for better performance. However, this is
not a hard rule and should be evaluated on a case-by-case basis, as modern
JavaScript engines have been improving their optimizations for functional
methods. Always profile and benchmark to determine the best approach for your
specific use case.

Higher-order methods are fine for initialization, configuration, and code that
is not on the hot path.

## Typed arrays for numeric and binary data

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

## SharedArrayBuffer for concurrency

When data must be shared across Workers without serialization overhead, back the
typed array with a `SharedArrayBuffer`. Use `Atomics` operations
(`Atomics.load`, `Atomics.store`, `Atomics.add`, `Atomics.compareExchange`,
`Atomics.wait`/`Atomics.waitAsync`) for all accesses to shared state to avoid
data races. Document the memory ordering assumptions with each `Atomics` call —
`Atomics` provides sequentially-consistent ordering for individual operations
but not for multi-step sequences without explicit coordination.

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

## Strings should not be used as enums

JavaScript engines tend to internalize strings, but this is not guaranteed and
if string values are created, it might not work at all.

Therefore, it's better to use symbols or numbers as enums.

It is okay to use strings for values on the border of the system, e.g. for JSON
serialization or for values that are used in external APIs, but they should not
be used internally in the library - we encode them as symbols or numbers and
convert them to strings on the border of the system.

## Choose the right map type for the key set

Using objects as maps can lead to polymorphism and megamorphism, especially if
the keys are not known in advance. It's better to use Map or WeakMap as a
baseline for maps, and only use plain objects when the keys are known and fixed,
or if profiling shows that using plain objects is faster in a specific case.

When the set of keys is **known and fixed at compile time**, use a plain object
— V8 compiles fixed-shape property access to a direct memory offset load,
avoiding `Map`'s per-lookup hashing overhead. When keys are **dynamic or
unknown at compile time**, use `Map` or `WeakMap` — plain objects with
arbitrary string keys degrade to dictionary mode.

## Pre-compute at initialization, not per-call

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

## Offload non-critical work from hot paths

Operations not on the critical response path — logging, metrics collection,
analytics, serialization for external systems — should be **deferred or
offloaded**:

- `setTimeout(fn, 0)` — next macrotask
- `queueMicrotask(fn)` — end of current task, before next macrotask
- `worker_threads` — for CPU-heavy processing (logging transports, encoding)

Use the platform's built-in event loop monitoring to measure impact:
- Node.js: `perf_hooks.monitorEventLoopDelay()`, `performance.eventLoopUtilization()`
- Bun: equivalent built-in APIs

Do **not** reinvent event loop monitoring — the platform APIs are
well-optimized and well-maintained.

## Backpressure at producer-consumer boundaries

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

## Security at parse boundaries

Validate and sanitize at system boundaries where **untrusted data enters**.
Internal code paths between trusted modules need not re-validate.

Specific threats to address at parse boundaries:
- **Prototype pollution**: filter `__proto__` and `constructor` keys from
  parsed JSON
- **Schema compliance**: validate before processing, reject early with
  `Result.err()`
- **Input size**: bound input length before parsing to prevent DoS

Do **not** add validation in internal hot paths between trusted modules —
that is wasted CPU. Validate once at the boundary, then trust the result.

## GC-aware allocation patterns

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
   reuse them (object pools).

3. **Avoid allocation in tight loops** — each iteration that creates an object
   produces Scavenger work proportional to iteration count. Use pre-allocated
   typed arrays or pool acquire/release instead.

4. **`WeakRef` + `FinalizationRegistry`** — for caches of expensive objects
   that should not prevent GC. The runtime will clean them up when memory
   pressure rises. Cleanup callbacks are non-deterministic — never rely on
   them for correctness.

```ts
// Good: reuse pool objects in hot loop
for (let i = 0; i < N; i++) {
  const obj = Pool.acquire(pool);
  process(obj);
  Pool.release(pool, obj);
}

// Bad: allocate per iteration — Scavenger runs N times
for (let i = 0; i < N; i++) {
  process({ x: 0, y: 0 }); // N heap objects created and discarded
}
```

## Common anti-patterns

### Do NOT create closures inside loops

Each iteration allocates a new closure object on the heap. Capture
loop-invariant references in a local variable before the loop, or use a
module-level helper function.

### Do NOT use recursion in tree traversals on untrusted input

Recursive traversal is bounded by call-stack depth (~10K frames in V8).
Malicious or deeply nested input causes a stack overflow. Use an explicit
stack array instead.

### Do NOT use `Object.keys()` + `forEach` in hot paths

`Object.keys()` allocates a new array. Use `for...in` with
`Object.hasOwn()` or, better, redesign the data structure to avoid
property enumeration in hot code.

## Any trade-offs should be documented and revised regularly

If a trade-off is made for performance reasons, it should be documented in the
codebase and revised regularly to ensure that it is still valid and does not
introduce any performance issues. JS engines are constantly evolving, and what
might be a good trade-off today might not be in the future. Regularly revisiting
these trade-offs can help ensure that the library remains performant over time.

Every unusual pattern — double-write, `Reflect.apply`, typed array,
loop-instead-of-map, switch-unroll, SharedArrayBuffer, Atomics — **must** carry
a comment that:
1. States the JIT behavior being exploited or avoided.
2. Describes what breaks without it (deopt cascade, megamorphic IC, etc.).
3. Names the specific case where this matters.

The *what* is the code. The comment explains the *why*.

## CPU and memory profiling

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

## Further Reading

[js-performance-links.md](js-performance-links.md) is a curated list of
resources for learning about JavaScript engine internals and performance
patterns.
