# scriptc bench

The same benchmark programs run three ways: under Bun, under Node, and as a
native binary built by [scriptc](https://github.com/vercel-labs/scriptc)
(version pinned in `.github/workflows/ci.yml`, 0.4.4). Use it to compare the
runtimes per benchmark. The mitata suites in `src/benchmarks/` (`bench:bun`,
`bench:node`) stay the reference for Bun and Node tuning.

```bash
npm ci
npm install --no-save scriptc@0.4.4
npm run bench:compare        # bun, node, scriptc side by side
npm run bench:scriptc        # scriptc only
npm run bench:scriptc:check  # build + checksum diff, no timing (CI)
bun scripts/scriptc-bench/run.ts --modules Queue,BitSet --out results.tsv
```

`src/**/*.js` from `npm run build:test` shadows the `.ts` sources for Bun and
scriptc; `run.ts` refuses to start while any exist. Node runs JS that `tsc`
emits from the same sources into a temp dir (`tsconfig.json` here).

## Method

mitata does not run under scriptc 0.4.4: it builds, then the binary throws
SC1090 at startup (`'undefined'-typed computed property keys`,
`mitata/src/lib.mjs:64`). So all three kinds use `harness.ts`, which compiles
under scriptc and runs unchanged under Bun and Node:

- `bench(name, fn)` / `benchAsync(name, fn)`: `fn(i)` gets the call index and
  returns a number. Results are summed into a sink that is read after each
  bench, so neither a JIT nor LLVM can drop the work.
- Clock: `performance.now()`. scriptc lowers it to
  `clock_gettime(CLOCK_MONOTONIC)`.
- Batch size n doubles until one batch takes 2 ms; batches run until 200 ms
  have passed (JIT warm-up); then 25 timed batches. Reported: ns/op median
  and [min–max] over the 25.
- Each bench runs in its own process per kind (`--only N`), kinds interleaved
  per bench. On Bun and Node the timing call site then sees one `fn`, as
  mitata's generated loops do.
- `Harness: noop` is the per-call floor of each kind.

Before timing, `run.ts` runs every program with `--check` (256 calls per
bench, summed) and diffs the checksums of Node and scriptc against Bun. A
mismatch, crash or build error fails the run. Each timed process must
reproduce its bench's checksum too.

## Adding a module

Add `<Module>.bench.ts` here (or `schema-<Module>.bench.ts`); `run.ts` picks up
every `*.bench.ts`. A module with a bench file that scriptc cannot run yet goes
in `SCRIPTC_SKIP` in `run.ts` with the reason and still runs under Bun and Node;
when the issue is fixed, delete its line (try first with
`run.ts --check --no-skip --modules <Module>`).

## Coverage (scriptc 0.4.4)

Benchmarked on all three kinds: BatchExecutor, BitSet, BloomFilter,
BufferizedFunction, ErrorChain, FunctionUtils, HTML, Immutable, ISODate,
ISOTimestamp, JSON, LRUCache, Memoization, MemoryPool, OrderedMap, PRNG,
PriorityQueue, PromiseUtils, Queue, Ref, Result, TaggedUnion, TimedFunction,
UnixTimestamp, UUID, schema/Formats, schema/Schema.

Partly benchmarked:

| module        | left out                                            | why                                                                                       |
| ------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| BatchExecutor | batches of 4 or more items                          | reject with `TypeError: expected array \| undefined at $[0], got object` (unfiled, found here); the bench sends 3 |
| FunctionUtils | `pipe`, `partial`, `partialNamed`                   | do not compile (variadic `any`, `bind` on a generic, `Omit<>`; no issue cited)                  |
| Memoization   | `memoize`                                           | does not compile (SC2005, no issue cited; then SC2002, vercel-labs/scriptc#2143)                |
| MemoryPool    | `withAcquire`                                       | does not compile (returns `R` or `Promise<R>`; no issue cited)                                   |
| PromiseUtils  | `props`                                             | does not compile (vercel-labs/scriptc#2132)                                               |
| schema/Schema | `toJsonSchema`, `fromJsonSchema`, `propertyMayBeAbsent` | do not compile (reads `meta` on the whole `Schema` union; no issue cited)                    |

Bun and Node only:

| module    | why                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| RadixTree | build fails: SC2009 on `makeNode`'s `T & null` arm (unfiled, found here); behind it, symbol-keyed recursive nodes miscompile (vercel-labs/scriptc#2139) |

Not benchmarked (no scriptc build, see `scripts/scriptc-smoke/README.md`):

| module                                                  | why                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| WeakCache                                               | no `WeakRef` lowering (no issue cited)                                        |
| HttpServer                                              | `Socket` as a Map key; no `cork`/`uncork`/`writableNeedDrain` lowering (no issue cited) |
| SOA, Arbitrary, Property, StatefulTest                  | mapped and generic container types, `BigUint64Array` (SC2020), `Function.name` (no issue cited) |
| schema/Validate, schema/JSON, schema/TOON, schema/Codegen | compile validators with `new Function`; a native binary has no JS engine |
| WorkerPool (+ `.worker`, `.protocol`), FunctionReference | `worker_threads`; `import()` of a computed path                       |
| CoverageGuided                                          | `node:inspector`                                                       |
| schema/ValidationError                                  | no bench of its own; the ISODate validator bench constructs one        |

## Reading the numbers

- HTML: Bun takes the `Bun.escapeHTML` fast path; Node and scriptc run the JS
  `_escapeImpl`. UUID `v7`: Bun uses `Bun.randomUUIDv7`. JSON: each kind's own
  engine `JSON`.
- Modules whose state lives in `unique symbol`-keyed fields (Queue, BitSet,
  BloomFilter, LRUCache, MemoryPool, OrderedMap, PRNG, PriorityQueue, and
  BufferizedFunction through Queue) are where scriptc trails most, often by
  10x or more. A loop that reads and writes one symbol-keyed field took
  ~500 ns per iteration native against ~6 ns with a string key (unfiled,
  found here).
