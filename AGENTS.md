# AGENTS.md — vjuga Quick Reference for AI Coding Assistants

This file helps AI coding tools find the right module and use it correctly.
See `CLAUDE.md` for contributor conventions (testing, coverage, benchmarking,
docstring format). See `llms.txt` for the full module index with descriptions.

## Package at a glance

```
npm install @dolphin278/vjuga
```

- Zero runtime dependencies
- ESM-only (`"type": "module"`) — extensionless subpaths are supported; `.js` subpaths remain compatible
- Node.js >= 22
- No default exports — all modules use named exports
- Module-level API style: create with `make(...)`, operate with free functions

---

## I need to... → Use this module

### Error handling

| Goal | Module | Key exports |
|---|---|---|
| Return errors without throwing | `Result` | `ok`, `err`, `isOk`, `isErr`, `map`, `flatMap`, `unwrapOr`, `fromThrowable`, `fromPromise` |
| Model 3+ variants (sum type) | `TaggedUnion` | `variant`, `match`, `is` |
| Walk a nested `Error.cause` chain | `ErrorChain` | `chain`, `toArray`, `find` |

### Caching

| Goal | Module | Notes |
|---|---|---|
| Cache with bounded memory, keep hottest items | `LRUCache` | Evicts least-recently-used. Always set `capacity`. |
| Cache large objects, let GC reclaim them | `WeakCache` | Values must be objects. `size()` may lag GC. |
| Cache pure function results | `Memoization` | `memoize(fn)`. Supply a bounded `Map` via `opts.cache` when key space is large; default cache is unbounded. |
| One-time lazy initialization (ignore arguments) | `Memoization` | `once(fn)` — calls `fn` exactly once. |
| Pool same-shape objects to avoid GC pressure | `MemoryPool` | For hot loops allocating thousands of objects per tick. Overhead not worth it for < ~10 items. |

### Data structures

| Goal | Module | Notes |
|---|---|---|
| FIFO / LIFO queue > 16 items | `Queue` | O(1) `push`/`pop`/`shift`/`unshift`. Circular buffer, auto-grows. |
| Priority-ordered extraction (min first) | `PriorityQueue` | Binary min-heap. Supply comparator at construction. |
| Prefix-keyed lookup / URL routing / autocomplete | `RadixTree` | `insert`, `lookup`, `prefixMatch`. Outperforms `Map` for prefix scans. |
| Cache-friendly iteration over many records | `SOA` | Structure of Arrays. Use for tight loops, ECS, columnar data. |
| Sorted key-value map with floor/ceiling/range | `OrderedMap` | AVL tree. `make(compare?)`, `set`, `get`, `has`, `del`, `min`, `max`, `floor`, `ceiling`, `range`, `keys`, `values`, `entries`. Use when sorted order or range queries matter; for unordered lookup use plain `Map`. |
| Compact dense boolean vector or set algebra | `BitSet` | `Uint32Array`-backed. `make(capacity)`, `set`, `clear`, `toggle`, `get`, `popcount` (SWAR), `toArray`, `and`, `or`, `xor`, `not`. Use for SOA row flags, graph adjacency, or bit-parallel set operations. |
| Fast "definitely absent" pre-filter | `BloomFilter` | Probabilistic. `make(capacity, fpr?)`, `add`, `mightContain`, `clear`, `count`. No false negatives. Use before expensive DB or cache lookups to skip work when item is definitely absent. |

### Async & concurrency

| Goal | Module | Notes |
|---|---|---|
| Batch items but return per-item promises | `BatchExecutor` | Dataloader pattern. `make(batchFn)` returns `(item) => Promise<R>`. Batch fn must return exactly as many results as items. |
| Batch fire-and-forget (logs, events, analytics) | `BufferizedFunction` | No per-item return. Schedule: `"macrotask"` (default) or `"io"`. |
| Rate-limit continuous events (scroll, resize) | `TimedFunction` | `throttle(fn, ms)` — leading-edge. |
| Wait until activity stops (search input) | `TimedFunction` | `debounce(fn, ms)` — trailing-edge. |
| Resolve named promises in parallel | `PromiseUtils` | `props({ a: p1, b: p2 })` → `{ a, b }`. |
| Offload CPU-bound work to threads | `WorkerPool` | `make({ filename, maxThreads? })`, `run(pool, data)`. Worker must be a separate file exporting a `default` function. |

### Type safety / branded types

| Goal | Module | Key exports |
|---|---|---|
| ISO 8601 timestamp strings | `ISOTimestamp` | `isoTimestamp`, `fromDate`, `toDate`, `now`, `fromEpochMs` |
| Unix epoch seconds | `UnixTimestamp` | `unixTimestamp`, `fromDate`, `toDate`, `now`, `fromISO`, `toISO` |
| UUID strings (v4 / v7) | `UUID` | `uuid`, `v4`, `v7`, `version` |
| Deep readonly at API boundary | `Immutable` | `make(value)` — zero-cost type cast, no runtime enforcement |
| Pass-by-reference for primitives into closures | `Ref` | `make`, `get`, `set` |
| Branded numbers (positive int, etc.) | `FunctionUtils` | `positiveInteger`, `nonNegativeInteger`, `integer`, `positiveNumber` |

### Schema & validation

| Goal | Module | Notes |
|---|---|---|
| Define a schema once, use many ways | `schema/Schema` | 14 kinds. `S.Infer<typeof schema>` for TypeScript type. Source of truth for Validate, JSON, TOON, Arbitrary. |
| Validate unknown input at runtime | `schema/Validate` | `validate(schema)` compiles once at init; returns `Result<T, SchemaError>`. |
| Fast JSON serialization / deserialization | `schema/JSON` | `stringify(schema)` up to 11x faster for small objects. `parse(schema)` validates + parses in one pass. Compile at module scope. |
| Token-efficient serialization (LLM / config) | `schema/TOON` | 40–50% smaller than JSON. Tabular arrays. |
| Custom validator with structured errors | `schema/ValidationError` | `ValidationError`, `Validator<T>` type. |

### I/O

| Goal | Module | Notes |
|---|---|---|
| Escape user content for HTML | `HTML` | `escape(str)` — encodes `& < > " '`. |
| Minimal HTTP/1.1 JSON API server | `HttpServer` | Only when `node:http` overhead is a profiled bottleneck. No HTTP/2, no chunked encoding. |
| Typed JSON parse with prototype-pollution guard | `JSON` | `safeParse(str)` → `Result<JSONValue>`. Use for all untrusted input. |

### Testing

| Goal | Module | Notes |
|---|---|---|
| Generate typed random test data | `Arbitrary` | `integer`, `string`, `array`, `oneOf`, `map`, `chain`, `letrec`. Shrinking is built in. |
| Run property-based tests | `Property` | `assert(arb, predicate, { numRuns: 500 })`. Use inside `node:test`. |
| Test stateful APIs via command sequences | `StatefulTest` | `assertStateful({ initialModel, initialReal, commands })`. |
| Find crash inputs in parsers / validators | `CoverageGuided` | `fuzz(arb, fn)`. Uses V8 coverage feedback; ~5–10x slower than PBT. |
| Reproducible / splittable randomness | `PRNG` | `seed(bigint)`, `make`, `next`, `nextInt`, `split`. Not cryptographic. |

### Functional

| Goal | Module | Notes |
|---|---|---|
| Left-to-right function composition | `FunctionUtils` | `pipe(f, g, h)` — up to 5 functions with full TypeScript type inference. |
| Partial application | `FunctionUtils` | `partial(fn, ...args)`, `partialNamed(fn, { key: val })`. |
| Cross-thread / cross-process function dispatch | `FunctionReference` | `resolve("./module.ts#export")` via dynamic `import()`. Not needed for same-thread callbacks. |

---

## Correct import syntax

```typescript
// Namespace imports (most common — preserves module identity)
import * as Result from "@dolphin278/vjuga/Result";
import * as LRUCache from "@dolphin278/vjuga/LRUCache";
import * as S from "@dolphin278/vjuga/schema/Schema";

// Named imports also work
import { ok, err, isOk, type Result as ResultType } from "@dolphin278/vjuga/Result";
import { variant, match } from "@dolphin278/vjuga/TaggedUnion";

// Schema sub-paths
import { validate } from "@dolphin278/vjuga/schema/Validate";
import * as SJ from "@dolphin278/vjuga/schema/JSON";
import * as ST from "@dolphin278/vjuga/schema/TOON";
```

Extensionless subpaths are recommended for package consumers. `.js` subpaths
remain supported for compatibility.

---

## Common composition patterns

### Result + Schema validation

```typescript
import * as S from "@dolphin278/vjuga/schema/Schema";
import { validate } from "@dolphin278/vjuga/schema/Validate";

const UserSchema = S.object({ id: S.integer(), name: S.string() });
const checkUser = validate(UserSchema); // compile once at module scope

// In request handler:
const [ok, userOrErr] = checkUser(body);
if (!ok) return sendError(userOrErr); // userOrErr is SchemaError
// userOrErr is fully-typed User here
```

### LRUCache + Memoization

```typescript
import * as LRUCache from "@dolphin278/vjuga/LRUCache";
import { memoize } from "@dolphin278/vjuga/Memoization";

// Bounded memoization: keep at most 1000 cached results
const cache = LRUCache.make<string, User>(1000);
const getUser = memoize(fetchUser, { cache });
```

### BatchExecutor for database fan-out

```typescript
import { make } from "@dolphin278/vjuga/BatchExecutor";

const getUser = make(async (ids: string[]): Promise<PromiseSettledResult<User>[]> => {
  const rows = await db.users.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => {
    const u = byId.get(id);
    return u
      ? { status: "fulfilled", value: u }
      : { status: "rejected", reason: new Error(`User ${id} not found`) };
  });
});

// Each concurrent caller is batched automatically
const user = await getUser(userId);
```

### WorkerPool for CPU-bound tasks

```typescript
// worker.ts — separate file, exports a default function
export default function processImage(data: { buffer: ArrayBuffer }): ArrayBuffer {
  return transform(data.buffer); // CPU-intensive
}

// main.ts
import * as WorkerPool from "@dolphin278/vjuga/WorkerPool";
const pool = WorkerPool.make<{ buffer: ArrayBuffer }, ArrayBuffer>({
  filename: new URL("./worker.js", import.meta.url),
  maxThreads: 4,
});
const result = await WorkerPool.run(pool, { buffer }, { transferList: [buffer] });
await WorkerPool.destroy(pool);
```

### TaggedUnion for multi-variant state

```typescript
import { variant, match, type TaggedUnion } from "@dolphin278/vjuga/TaggedUnion";

type State = TaggedUnion<{
  idle: void;
  loading: { requestId: string };
  error: { message: string };
  success: { data: User[] };
}>;

const handle = (state: State): string =>
  match(state, {
    idle: () => "Idle",
    loading: ({ requestId }) => `Loading ${requestId}`,
    error: ({ message }) => `Error: ${message}`,
    success: ({ data }) => `${data.length} users`,
  });
```

### Property-based testing with node:test

```typescript
import { test } from "node:test";
import * as Arb from "@dolphin278/vjuga/Arbitrary";
import * as Prop from "@dolphin278/vjuga/Property";

test("encode/decode roundtrip", () => {
  Prop.assert(
    Arb.string(),
    (s) => decode(encode(s)) === s,
    { numRuns: 500 },
  );
});
```

---

## Key constraints for code generation

1. **No default exports** — all modules use named exports. Always use namespace
   imports (`import * as X`) or named destructuring.
2. **Import subpaths** can be extensionless or use `.js`; extensionless is recommended for consumers.
3. **Module-level API style** — modules export free functions operating on plain
   objects/interfaces. Create with `make(...)`, operate with `Module.fn(handle, ...)`.
   There are no classes (except `WorkerPoolDestroyedError`).
4. **Compile-time init for schemas** — `validate(schema)`, `SJ.stringify(schema)`, and
   `SJ.parse(schema)` use `new Function` internally. Call them once at module scope,
   not inside request handlers.
5. **WorkerPool requires a separate worker file** — the worker module must be a
   standalone `.js`/`.ts` file exporting a `default` function.
6. **BatchExecutor batch-function contract** — must return exactly as many
   `PromiseSettledResult` items as it received; a length mismatch throws at runtime.
7. **WeakCache values must be objects** — `string`, `number`, `boolean`, and other
   primitives are rejected by `WeakRef`.
8. **`Immutable.make` is a type-cast only** — it does not freeze or seal the
   object. Mutation is still possible at runtime; the guarantee is compile-time only.
9. **WorkerPool and HttpServer are Node.js-only** — they use `node:worker_threads`
   and `node:net` respectively. Not available in browsers or edge runtimes.
