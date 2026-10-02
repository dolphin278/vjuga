# vjuga

A zero-dependency toolkit for TypeScript that actually ships.

> "Tired of installing 5 packages for things I use every day." — every developer

Every utility you reach for, minus the dependency tree. Optimized for real-world workloads, tested with property-based testing and fuzzing, built to not slow your app down.

## Install

```bash
npm install @dolphin278/vjuga
```

There is no root export. Import a module subpath:

```ts
import * as Result from "@dolphin278/vjuga/Result";
import * as S from "@dolphin278/vjuga/schema/Schema";
```

## For coding agents

This package ships version-matched [AGENTS.md](./AGENTS.md) and [llms.txt](./llms.txt).
Add this block to your project's `AGENTS.md`:

```md
When working with `@dolphin278/vjuga`, read `node_modules/@dolphin278/vjuga/AGENTS.md` first. There is no root export — import `@dolphin278/vjuga/<Module>`. Your training data is outdated; the installed docs are the source of truth.
```

In a monorepo, resolve `node_modules/@dolphin278/vjuga` from the directory that
depends on the package.

## What's Inside

### Error handling
Result for explicit errors without thrown exceptions. ok, err create tagged unions. map, flatMap, unwrapOr chain results. TaggedUnion for sum types with exhaustive pattern matching. ErrorChain walks nested cause chains to find root errors.

### Caching
LRUCache with bounded memory - automatic LRU eviction keeps hottest items. WeakCache for large objects - GC reclaims values when unreferenced. Memoization with custom cache and key functions. MemoryPool recycles same-shape objects to avoid GC pressure in hot loops, pre-allocates minimum objects.

### Async
BatchExecutor implements the dataloader pattern - batches N concurrent calls into one DB call, returns per-item promises. BufferizedFunction for fire-and-forget (logs, events, analytics) - macrotask or io scheduling. TimedFunction throttles leading-edge or debounces trailing-edge. WorkerPool spawns worker threads for CPU-bound work, handles error forwarding and crash recovery.

### Data structures
Queue - FIFO/LIFO with O(1) push/pop/shift/unshift, circular buffer that auto-grows, handles more than 16 items efficiently. PriorityQueue - binary min-heap with custom comparators, handles duplicate values. RadixTree - prefix-keyed lookup, autocomplete, URL routing, outperforms Map for prefix scans. BloomFilter - probabilistic membership with no false negatives, tunable false positive rate, use before expensive DB lookups. BitSet - compact Uint32Array-backed bit vector with set algebra (and, or, xor, not) for dense boolean vectors, graph adjacency, row-level flags. OrderedMap - AVL tree sorted key-value map with floor, ceiling, range queries in sorted order. SOA - structure of arrays for cache-friendly iteration in tight loops, columnar data, ECS patterns.

### Schema
Validate compiles schemas to code-generated validators - one pass validation at runtime. JSON stringify/parse generate typed one-pass parse+validate and serializers that emit only declared keys, with a prototype-pollution guard. TOON is up to ~50% smaller than JSON for tabular data (token-efficient contexts). Schema composable type definitions with 18 kinds: primitive, array, object, record, union (and exclusive `oneOf`), tuple, nullable, optional, literal, enum, unknown, allOf, not, if/then/else, and more; `fromJsonSchema` lowers JSON Schema 2020-12 (`$ref`, combinators, formats).

### Types
Branded ISOTimestamp, ISODate, UnixTimestamp validates and brands at construction time. UUID v4 random and v7 time-ordered.

### Testing
Property.check() runs property-based tests - generates random input, shrinks to minimal counterexamples automatically. StatefulTest.assertStateful() for model-based stateful testing with oracle model. CoverageGuided.fuzz() is time-boxed random fuzzing; fuzzAsync() adds V8 coverage feedback.

## Why this exists

- **Zero dependencies** — import only the modules you use
- **100% test coverage** — baseline unit tests + property-based + fuzz testing verifies correctness
- **Node.js + Bun** — every change profiled on both runtimes, sub-microsecond hot paths on hot code paths
- **Fuzzed** — CoverageGuided.fuzz() finds crash inputs under a time budget and shrinks to a minimal reproducing case; fuzzAsync() uses V8 coverage feedback to steer generation (~5–10x slower per run than property tests)

## Design

- Named exports only, no default exports - always use namespace imports or named destructuring
- Make + free functions; classes exist only for errors (e.g. WorkerPoolDestroyedError, ValidationError)
- ESM-only, zero runtime dependencies
- No root export — import `@dolphin278/vjuga/<Module>`
- Extensionless subpath imports are supported; `.js` subpaths remain compatible
- Works identically on Node.js and Bun

Contributor policy lives in the git repository:
https://github.com/dolphin278/vjuga/blob/master/CONTRIBUTING-AGENTS.md
