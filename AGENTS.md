# AGENTS.md — @dolphin278/vjuga

Version-matched docs for coding agents. Training data is outdated — this file
and [llms.txt](./llms.txt) match the installed package.

## Package at a glance

```
npm install @dolphin278/vjuga
```

- Zero runtime dependencies
- ESM-only (`"type": "module"`) — extensionless subpaths are supported; `.js` subpaths remain compatible
- Node.js >= 22
- No default exports — all modules use named exports
- Module-level API style: create with `make(...)`, operate with free functions
- **No root export.** `import from "@dolphin278/vjuga"` does not resolve. Import a module subpath.

## How to load docs

1. Use the tables below to pick a module.
2. Read [llms.txt](./llms.txt) for when-to-use text and the full index.
3. Open one API file: `node_modules/@dolphin278/vjuga/src/<Module>.d.ts` (schema modules live under `src/schema/`).
4. Load that one module. Do not ingest the whole package.

## Point your project at this package

When working with `@dolphin278/vjuga`, read `node_modules/@dolphin278/vjuga/AGENTS.md` first. There is no root export — import `@dolphin278/vjuga/<Module>`. Your training data is outdated; the installed docs are the source of truth.

Add that paragraph to your app's `AGENTS.md`. In a monorepo, resolve `node_modules/@dolphin278/vjuga` from the directory that depends on the package, not from the repo root.

---

## I need to... → Use this module

### Error handling

| Goal | Module | Key exports |
|---|---|---|
| Return errors without throwing | `Result` | `ok`, `err` (`const` type params: `ok(true)` is `Ok<true>`), `isOk`, `isErr`, `map`, `mapErr`, `flatMap`, `unwrapOr`, `unwrap`, `fromThrowable`, `fromPromise`, `fromAsyncThrowable` (never throws synchronously) |
| Model 3+ variants (sum type) | `TaggedUnion` | `variant`, `match` (TypeError on missing handler; validate untrusted input first), `is` |
| Walk a nested `Error.cause` chain | `ErrorChain` | `chain`, `toArray`, `find(predicate, error)`; cycles are safe |

### Caching

| Goal | Module | Notes |
|---|---|---|
| Cache with bounded memory, keep hottest items | `LRUCache` | Evicts least-recently-used. Always set `capacity`. |
| Cache large objects, let GC reclaim them | `WeakCache` | Values must be objects. `size()` may lag GC. |
| Cache pure function results | `Memoization` | `memoize(fn)`. Default cache is unbounded: pass a bounded `opts.cache` (`get`/`has`/`set`, e.g. an `LRUCache` adapter) for large key spaces. Default key `JSON.stringify(args)` collides for `null`/`undefined`/`NaN`/Maps/Sets and throws on BigInt: pass `cacheKeyFn`. Rejected promises are cached. |
| One-time lazy initialization (ignore arguments) | `Memoization` | `once(fn)` — calls `fn` until it succeeds once (retries after a throw). |
| Pool same-shape objects to avoid GC pressure | `MemoryPool` | For hot loops allocating thousands of objects per tick. `make` throws `RangeError` on invalid `maxSize`/`minSize`. Overhead not worth it for < ~10 items. |

### Data structures

| Goal | Module | Notes |
|---|---|---|
| FIFO / LIFO queue > 16 items | `Queue` | O(1) `push`/`pop`/`shift`/`unshift`. Circular buffer, grows and shrinks. |
| Priority-ordered extraction (min first) | `PriorityQueue` | Binary min-heap, not stable. Supply comparator at construction; a throwing comparator leaves the heap unchanged. |
| Prefix-keyed lookup / URL routing / autocomplete | `RadixTree` | `insert`, `lookup`, `prefixMatch` (results in lexicographic key order). `insert(k, undefined)` removes. Outperforms `Map` for prefix scans. |
| Cache-friendly iteration over many records | `SOA` | Structure of Arrays. `index` is a reserved column name; `set` throws `RangeError` unless `0 <= i < length`; don't change the column set after the first `get`/`pop`. Use for tight loops, ECS, columnar data. |
| Sorted key-value map with floor/ceiling/range | `OrderedMap` | AVL tree. `make(compare?)`, `set`, `get`, `has`, `del`, `min`, `max`, `floor`, `ceiling`, `range`, `keys`, `values`, `entries`, `forRange(m, lo, hi, fn)` (hot-path range scan), `size`. Total-order default comparator (NaN last, `-0` equals `0`). Use when sorted order or range queries matter; for unordered lookup use plain `Map`. |
| Compact dense boolean vector or set algebra | `BitSet` | `Uint32Array`-backed. `make(capacity)`, `set`, `clear`, `toggle`, `get`, `capacity`, `popcount` (SWAR), `toArray`, `and`, `or`, `xor`, `not`. Use for SOA row flags, graph adjacency, or bit-parallel set operations. |
| Fast "definitely absent" pre-filter | `BloomFilter` | Probabilistic. `make(capacity, fpr?)`, `add`, `mightContain`, `clear`, `count`, `bitCount`, `hashCount`. Strings only; no false negatives; `make` throws `RangeError` if `fpr` is unreachable or NaN (m capped at 2^32 bits). Use before expensive DB or cache lookups to skip work when item is definitely absent. |

### Async & concurrency

| Goal | Module | Notes |
|---|---|---|
| Batch items but return per-item promises | `BatchExecutor` | Dataloader pattern. `make(batchFn, options?)` returns `(item) => Promise<R>`; options `"io"` or `{ schedule?, maxBatchSize?, maxInFlight? }` (items queue FIFO beyond `maxInFlight` and coalesce into chunks of up to `maxBatchSize`). Batch fn must return exactly as many results as items; a mismatch or throw rejects every promise in that chunk. |
| Batch fire-and-forget (logs, events, analytics) | `BufferizedFunction` | No per-item return. Schedule: `"macrotask"` (default) or `"io"`. |
| Rate-limit continuous events (scroll, resize) | `TimedFunction` | `throttle(fn, ms)` — leading-edge; re-entrant calls dropped, a throwing `fn` still starts the window. |
| Wait until activity stops (search input) | `TimedFunction` | `debounce(fn, ms)` — trailing-edge. |
| Resolve named promises in parallel | `PromiseUtils` | `props({ a: p1, b: p2 })` → `{ a, b }` (own enumerable string+symbol keys; null-prototype result). |
| Run N async tasks, at most K at a time | `PromiseUtils` | `pool(items, limit, fn, { signal? })` → `PromiseSettledResult[]` in input order; abort stops new starts. Async I/O limiter (use `WorkerPool` for CPU-bound threads). |
| Offload CPU-bound work to threads | `WorkerPool` | `make({ filename, maxThreads? })`, `run(pool, data)`. `filename` is a cwd-relative path or URL; worker gets `workerData.userData`. Also `activeCount`, `pendingCount`, `drain`, `destroy`; `run` opts `priority`, `signal`, `transferList`. Equal priorities run FIFO. Worker must be a separate file exporting a `default` function. |

### Type safety / branded types

| Goal | Module | Key exports |
|---|---|---|
| ISO 8601 timestamp strings | `ISOTimestamp` | `isoTimestamp` (any fraction length, rejects impossible dates and hour 24), `fromDate`, `toDate` (truncates to ms), `now`, `fromEpochMs`; RFC 3339 predicates `isRfc3339DateTime(s)`, `isRfc3339Time(s)` |
| Date-only `YYYY-MM-DD` strings | `ISODate` | `isoDate` (rejects impossible dates), `isISODate(s)`, `fromDate` / `today()` (UTC), `addDays(d, n)`, `toDate` (UTC midnight), `daysInMonth(y, m)`, `validator()` |
| Unix epoch seconds | `UnixTimestamp` | `unixTimestamp` (brand does not enforce seconds or integers), `fromDate`, `toDate`, `now`, `fromISO`, `toISO` |
| UUID strings (v4 / v7) | `UUID` | `uuid` (lowercases; accepts Nil/Max), `v4`, `v7`, `version`, `NIL`, `MAX` |
| Deep readonly at API boundary | `Immutable` | `make(value)` — zero-cost type cast, no runtime enforcement |
| Pass-by-reference for primitives into closures | `Ref` | `make`, `get`, `set` |
| Branded numbers (positive int, etc.) | `FunctionUtils` | `positiveInteger` (also a `NonNegativeInteger`), `nonNegativeInteger`, `integer`, `positiveNumber` |

### Schema & validation

| Goal | Module | Notes |
|---|---|---|
| Define a schema once, use many ways | `schema/Schema` | 18 kinds (`S.null_()`, `S.enum_()`, `S.unknown()`, `S.allOf()`, `S.not()`, `S.conditional()`; `S.oneOf()` = exclusive union). `S.Infer<typeof schema>` for TypeScript type; `toJsonSchema`, `fromJsonSchema(js, { refs, formats })` (JSON Schema 2020-12 incl. `$ref`/`oneOf`/`allOf`/`not`/`if`; `Err` for anything it cannot express, recursive `$ref` included; `formats: "strict"` = `Err` on unknown `format` names). `S.object()` rejects undeclared own keys unless `{ additionalProperties: true }`; `S.number()` rejects NaN/±Infinity. Source of truth for Validate, JSON, TOON. |
| Validate unknown input at runtime | `schema/Validate` | `validate(schema)` compiles once at init; returns `Result<T, SchemaError>`. `validate(schema, { allErrors: true })` returns every failure as `SchemaError[]`. Unions accept a value only if some variant fully validates it; `oneOf` only if exactly one does. Formats `date-time`/`date`/`time` (RFC 3339), `email`, `uri`, `uuid`, `ipv4`, `ipv6` are enforced; legacy `iso-datetime` is a loose prefix check; other names are ignored. |
| Check a string `format` / list enforced names | `schema/Formats` | `isEmail`, `isUri`, `isUuid`, `isIPv4`, `isIPv6`, `KNOWN_FORMATS`, `isKnownFormat`, `formatTester`. |
| Fast JSON serialization / deserialization | `schema/JSON` | Typed one-pass parse+validate (`parse(schema)`); `stringify(schema)` emits only declared keys (`unknown` / `not` values as-is), non-finite → `null`, and is not faster than native `JSON.stringify` once output is consumed. Compile at module scope. |
| Token-efficient serialization (LLM / config) | `schema/TOON` | ~50% smaller than JSON for tabular arrays (~20% flat objects, little for nested). Nested list items and discriminated unions supported; unsupported shapes throw at compile time. |
| Custom validator with structured errors | `schema/ValidationError` | `ValidationError`, `Validator<T>` type. |
| Extend schema code generators | `schema/Codegen` | Internal plumbing for generated validators/serializers. Route every schema-derived value spliced into generated code through `jsLiteral`. Application code rarely imports this directly. |

### I/O

| Goal | Module | Notes |
|---|---|---|
| Escape user content for HTML | `HTML` | `escape(str)` — encodes `& < > " '`. Not enough for JSON in `<script>`: `JSON.stringify` alone is unsafe there. |
| Minimal HTTP/1.1 JSON API server | `HttpServer` | Only when `node:http` overhead is a profiled bottleneck. `make(handler, options?)`, `listen`, `close`, `respond`, `respondRaw`, `respondBuffer`, `precompute`, `getHeader`, `GET`/`POST`/`PUT`/`DELETE`/`PATCH` (other methods → 0). Options: `maxHeaderSize` (431), `maxBodySize` (413), `headersTimeout`, `keepAliveTimeout`, `onError`. Strict framing: 400 + close on bad Content-Length/bare LF/folded headers, 501 on Transfer-Encoding. Handlers must answer via a `respond*` call. No HTTP/2. |
| Typed JSON parse; prototype-pollution guard in `safeParse` only | `JSON` | `safeParse(str, opts?)` → `Result<JSONValue, string>`; strips `__proto__`/`constructor` (also `\u`-escaped), or `Err` with `{ onDangerousKey: "reject" }`; syntax `Err` is `"invalid JSON: <engine message>"`. Unknown policies fail closed (reject); types `SafeParseOptions`, `DangerousKeyPolicy`. `findDangerousKey(value)` checks an already-parsed value. `parse` / `parseExn` do NOT filter keys. Use `safeParse` for all untrusted input. |

### Testing

| Goal | Module | Notes |
|---|---|---|
| Generate typed random test data | `Arbitrary` | `integer`, `nat`, `float`, `bigint`, `date`, `string`, `array`, `uniqueArray`, `dictionary`, `oneOf`, `frequency`, `constantFrom`, `map`, `chain`, `letrec`. Shrinking is built in; `Tree.shrinks` must be re-iterable. |
| Run property-based tests | `Property` | `assert(arb, predicate, { numRuns: 500 })`; also `maxShrinkEvaluations`, `timeoutMs`, `path` replay (`run@size:idx…`, same `seed`). Use inside `node:test`. |
| Test stateful APIs via command sequences | `StatefulTest` | `assertStateful({ initialModel, initialReal, commands })`; generators receive the live model. Also `assertStatefulAsync`, `checkStateful*`; `maxShrinkEvaluations`, `timeoutMs`. |
| Find crash inputs in parsers / validators | `CoverageGuided` | `fuzz(arb, fn)` (random, time-boxed) / `fuzzAsync` (V8 coverage feedback; ~5–10x slower than PBT). `config.corpus` runs first; `maxCorpus` default 256. |
| Reproducible / splittable randomness | `PRNG` | `seed(bigint)`, `make`, `next`, `nextInt`, `split`. Not cryptographic. |

### Functional

| Goal | Module | Notes |
|---|---|---|
| Left-to-right function composition | `FunctionUtils` | `pipe(f, g, h)` — needs at least 1 function; up to 5 with full TypeScript type inference. |
| Partial application | `FunctionUtils` | `partial(fn, ...args)`, `partialNamed(fn, { key: val })`. |
| Cross-thread / cross-process function dispatch | `FunctionReference` | `resolve("./module.ts#export")` via dynamic `import()`. String refs are `file:` URLs or cwd-relative paths; prefer `new URL("./x.js#fn", import.meta.url)`. Not needed for same-thread callbacks. |

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

// Bounded memoization: keep at most 1000 cached results.
// `cache` needs only get/has/set, so adapt the LRUCache handle.
const lru = LRUCache.make<string, Promise<User>>(1000); // fetchUser is async
const getUser = memoize(fetchUser, {
  cache: {
    get: (k) => LRUCache.get(lru, k),
    has: (k) => LRUCache.has(lru, k),
    set: (k, v) => LRUCache.set(lru, k, v),
  },
});
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
2. **No root export** — import `@dolphin278/vjuga/<Module>` or
   `@dolphin278/vjuga/schema/<Module>`. `import from "@dolphin278/vjuga"` does
   not resolve. Subpaths can be extensionless or use `.js`; extensionless is
   recommended for consumers.
3. **Module-level API style** — modules export free functions operating on plain
   objects/interfaces. Create with `make(...)`, operate with `Module.fn(handle, ...)`.
   Classes exist only for errors: `ModuleResolutionError`, `ReferencedSymbolIsNotAFunction`, `WorkerPoolDestroyedError`, `WorkerExitError`, `MemoryPoolExhaustedError`, `MemoryPoolMinSizeError`, `ValidationError`.
4. **Compile-time init for schemas** — `validate(schema)`, `SJ.stringify(schema)`, and
   `SJ.parse(schema)` use `new Function` internally. Call them once at module scope,
   not inside request handlers.
5. **WorkerPool requires a separate worker file** — the worker module must be a
   standalone `.js`/`.ts` file exporting a `default` function.
6. **BatchExecutor batch-function contract** — must return exactly as many
   `PromiseSettledResult` items as it received; a length mismatch rejects that invocation's chunk.
7. **WeakCache values must be objects** — `string`, `number`, `boolean`, and other
   primitives are rejected by `WeakRef`.
8. **`Immutable.make` is a type-cast only** — it does not freeze or seal the
   object. Mutation is still possible at runtime; the guarantee is compile-time only.
9. **WorkerPool and HttpServer are Node.js-only** — they use `node:worker_threads`
   and `node:net` respectively. Not available in browsers or edge runtimes.

---

## Editing this repository

If `CONTRIBUTING-AGENTS.md` exists next to this file, you are in the git
repository. Follow it for coverage, fuzz, docstring, and verification rules.
That file is not published to npm.
