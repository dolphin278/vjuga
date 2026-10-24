# scriptc smoke

Each `*.ts` here is a consumer program. `run.sh` compiles it with
[scriptc](https://github.com/vercel-labs/scriptc), runs the native binary and
diffs its stdout against the same program under Bun. CI runs it with the
scriptc version pinned in `.github/workflows/ci.yml` (0.4.4).

```bash
npm ci
npm install --no-save scriptc@0.4.4
SCRIPTC="$PWD/node_modules/.bin/scriptc" scripts/scriptc-smoke/run.sh
```

`scripts/scriptc-bench/` times the same modules under Bun, Node and scriptc.

Workarounds for scriptc limitations in `src/` carry a comment naming the
limitation and, where filed, the upstream issue. Remove them when the issue is
fixed and this suite still passes.

## Module status (scriptc 0.4.4)

Covered by a consumer here (builds, runs, matches Bun): BatchExecutor, BitSet,
BloomFilter, BufferizedFunction, ErrorChain, HTML, Immutable, ISODate,
ISOTimestamp, JSON, LRUCache, MemoryPool, OrderedMap, PRNG, PriorityQueue,
PromiseUtils, Queue, Ref, Result, TaggedUnion, TimedFunction, UnixTimestamp,
UUID, schema/Formats, schema/Schema.

Partly covered:

| module        | does not compile                                         | why                                                              |
| ------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| BatchExecutor | (compiles) a batch of 4 or more items rejects at run time | `TypeError: expected array \| undefined at $[0], got object` (unfiled); the consumer here sends 2 |
| FunctionUtils | `pipe`, `partial`, `partialNamed`; `unreachable` on a string-literal union | variadic `any` implementation; `bind` on a generic; `Omit<>`; a `never`-narrowed string-literal argument (SC1090, unfiled) |
| Memoization   | `memoize`                                                | generic `defaultCacheKeyFn` fallback is not monomorphized (SC2005); behind it, the default `Map` cache is not coerced to `MemoizationCache` (SC2002, vercel-labs/scriptc#2143) |
| MemoryPool    | `withAcquire`                                            | one function returns either `R` or `Promise<R>`                  |
| PromiseUtils  | `props`; `propsMap` with mixed values                    | mapped result type; vercel-labs/scriptc#2132                     |
| schema/Schema | `toJsonSchema`, `fromJsonSchema`, `propertyMayBeAbsent` | reads `meta` on the whole `Schema` union                         |

Not supported:

| module                                      | why                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| RadixTree                                   | `RadixTree<number>` and `<string>` fail to build (SC2009 on `makeNode`'s `T & null` arm, unfiled); behind that, symbol-keyed recursive nodes miscompile (vercel-labs/scriptc#2139) |
| WeakCache                                   | no `WeakRef` lowering                                                  |
| HttpServer                                  | `Socket` as a Map key; no `cork`/`uncork`/`writableNeedDrain` lowering |
| SOA, Arbitrary, Property, StatefulTest      | mapped and generic container types, `BigUint64Array`, `Function.name`  |
| schema/Validate, JSON, TOON, Codegen        | compile validators with `new Function`; a native binary has no JS engine |
| WorkerPool (+ `.worker`, `.protocol`), FunctionReference | `worker_threads`; `import()` of a computed path              |
| CoverageGuided                              | `node:inspector`                                                       |
