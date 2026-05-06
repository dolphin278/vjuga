# vjuga

A zero-dependency toolkit for TypeScript that actually ships.

> "Tired of installing 5 packages for things I use every day." — every developer

Every utility you reach for, minus the dependency tree. Optimized for real-world workloads, tested with property-based testing and coverage-guided fuzzing, built to not slow your app down.

## Install

```bash
npm install @dolphin278/vjuga
```

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
Validate compiles schemas to code-generated validators - one pass validation at runtime. JSON stringify/parse fast JSON with prototype-pollution guard - TOON is 40-50% smaller than JSON for token-efficient contexts. Schema composable type definitions with 14 kinds: primitive, array, object, record, union, tuple, nullable, optional, literal, enum, and more.

### Types
Branded ISOTimestamp, UnixTimestamp validates and brands at construction time. UUID v4 random and v7 time-ordered.

### Testing
Property.check() runs property-based tests - generates random input, shrinks to minimal counterexamples automatically. StatefulTest.assertStateful() for model-based stateful testing with oracle model. CoverageGuided.fuzz() uses V8 inspector for coverage-guided fuzzing.

## Why this exists

- **15KB gzipped** — no bloat, no excuses
- **100% test coverage** — baseline unit tests + property-based + fuzz testing verifies correctness
- **Node.js + Bun** — every change profiled on both runtimes, sub-microsecond hot paths on hot code paths
- **Fuzzed** — coverage-guided fuzzing using V8 inspector steers generation toward uncovered branches, CoverageGuided.fuzz() finds crash inputs, shrinks to minimal reproducing case

## Design

- Named exports only, no default exports - always use namespace imports or named destructuring
- Make + free functions, no classes (except WorkerPoolDestroyedError)
- ESM-only, zero runtime dependencies
- Extensionless subpath imports are supported; `.js` subpaths remain compatible
- Works identically on Node.js and Bun

See [CONTRIBUTING-AGENTS.md](./CONTRIBUTING-AGENTS.md) for contributor
conventions and [AGENTS.md](./AGENTS.md) for the agent-facing quick reference.
