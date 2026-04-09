---
name: dolphin278-craft
description: >
  dolphin278's personal engineering codex: performance-first TypeScript/JavaScript,
  profiling methodology, testing, etc. Covers any modern JS/TS codebase.
---

You are writing high quality TypeScript or JavaScript code on par with quality of the **@dolphin278/vjuga** library, a zero-dependency, ESM-only TypeScript
utility library where every decision is evaluated against real JIT compiler
behavior — not just language correctness or abstract cleanliness. The code
must be readable, provably correct, and ruthlessly fast.

**Reference documents** (read when you need authoritative detail):
- [JS performance patterns](references/js-performance.md) — monomorphism rules, hot-path patterns, typed arrays, GC, profiling, and engine-specific guidance; links to [engine internals resources](references/js-performance-links.md)
- [TypeScript conventions](references/typescript.md) — strict TS, branded types, Result<T,E>, advanced type patterns, modules, testing, linting, coverage requirements

**vjuga library**: When working in a project that wants to use pre-built implementations of these patterns, check [`@dolphin278/vjuga` on npm](https://www.npmjs.com/package/@dolphin278/vjuga) for available modules (Result, Queue, Pool, etc.). Fetch the package README at runtime to discover the current module list and API surface.

---

## Core Principles

These principles are load-bearing. Reason from them to reach correct behavior
on cases not explicitly listed below. See the reference documents for detailed
patterns, code examples, and JIT-level rationale.

### 1. Monomorphism is the performance contract

JIT compilers generate optimal code for *monomorphic* call sites. Use factory
functions (not classes), free-floating functions (not method dispatch), and
`unique symbol` keys for private fields. See [js-performance.md](references/js-performance.md).

### 2. Write mutable fields twice at construction time

Write every mutable field a second time in the factory function to prevent JIT
constant-folding and deoptimization cascades on first mutation. See [js-performance.md](references/js-performance.md).

### 3. Result<T, E> is a readonly tuple — the discriminant is index 0

`Result<T, E>` is `readonly [boolean, T | E]`. Never throw for recoverable
conditions — return `Result.err(...)`. Use `Result.fromThrowable` and
`Result.fromPromise` to wrap APIs that throw. See [typescript.md](references/typescript.md).

### 4. No closures in hot paths

Closures allocate a heap object per creation and can block inlining. Capture
loop-invariant references outside the loop; use `Reflect.apply` or
arity-specialized switches. See [js-performance.md](references/js-performance.md).

### 5. Loops over array higher-order methods in hot paths

Use `for` loops instead of `map`/`filter`/`reduce` in hot code. Higher-order
methods are fine off the hot path. See [js-performance.md](references/js-performance.md).

### 6. Typed arrays for numeric data — SharedArrayBuffer for concurrency

Use typed arrays for numeric/binary data. Use `SharedArrayBuffer` + `Atomics`
for cross-Worker shared state. See [js-performance.md](references/js-performance.md).

### 7. Document every performance trade-off

Every unusual pattern must carry a comment stating the JIT behavior exploited,
what breaks without it, and the specific case. See [js-performance.md](references/js-performance.md).

### 8. Strict TypeScript with no escape hatches

`strict: true`, `isolatedModules`, `verbatimModuleSyntax`. No `any`, no
unexplained `!`, branded types for domain primitives, erasable syntax only.
See [typescript.md](references/typescript.md).

### 9. Follow the existing module's shape when extending

When adding to an existing module, use its established `unique symbol` names,
factory function name, and helper function naming conventions exactly. Do not
introduce a second symbol scheme or a new object shape for the same concept.
Consistency is what keeps call sites monomorphic across the entire module
boundary — two different shapes for "a queue" is two polymorphic hot paths.

### 10. Pre-compute at initialization, not per-call

Generate specialized functions or data structures **once** at startup. The hot
path should execute pre-compiled code. See [js-performance.md](references/js-performance.md).

### 11. Offload non-critical work from hot paths

Defer logging, metrics, analytics via `setTimeout`, `queueMicrotask`, or
`worker_threads`. See [js-performance.md](references/js-performance.md).

### 12. Backpressure at producer-consumer boundaries

Signal producers to slow down when consumers can't keep up. Return `false`
from writes, use bounded buffers, await flush. See [js-performance.md](references/js-performance.md).

### 13. Security at parse boundaries

Validate at system boundaries where untrusted data enters (prototype pollution,
schema compliance, input size). Do not re-validate in internal hot paths.
See [js-performance.md](references/js-performance.md).

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

## Testing & Benchmarking

100% coverage required (branches, statements, functions, lines). Benchmarks
must warm up 10K–100K iterations before measuring. Profiling is mandatory after
every hot-path change. See [typescript.md](references/typescript.md) for testing
details and [js-performance.md](references/js-performance.md) for benchmarking
and profiling methodology.

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
