# vjuga v7 Implementation Plan

## Status legend: [ ] todo  [x] done

## Phase 1 — Critical gaps

- [x] 1.1 `src/Result.ts` — Ok/Err tuple type + full API + tests + bench
- [x] 1.2 Branded types in `src/FunctionUtils.ts` — `Branded<>` type + `brand()` cast

## Phase 2 — Patch existing modules

- [x] 2.1 `src/Queue.ts` — add `peekFront` / `peekBack` + tests
- [x] 2.2 `src/SOA.ts` — add `length` / `swapRemove` / `clear` + tests
- [x] 2.3 `src/Memoization.ts` — doc: two-lookup undefined trick + defaultCacheKeyFn signature note

## Phase 3 — New modules

- [x] 3.1 `src/LRUCache.ts` — Int32Array SOA linked-list + Map; Map-compatible API; tests + bench
- [x] 3.2 `src/PriorityQueue.ts` — binary min-heap T[] (1-indexed); tests + bench
- [x] 3.3 `src/TimedFunction.ts` — `throttle` + `debounce` using Ref; tests
- [x] 3.4 `src/Validator.ts` — parser-combinator validators returning Result<T,E>; tests + bench

## Gates

All green:
- `npm run typecheck` ✓
- `npm test` ✓ (206/206)
- `npm run lint` ✓ (0 warnings, 0 errors)
- `npm run format` ✓
- Benchmarks authored for all new modules ✓
