/**
 * Run all benchmarks sequentially.
 *
 * Each individual bench file registers its own bench() calls and calls
 * await run() at the end. Because mitata's bench registry is module-level
 * state, we cannot safely import all files together and call run() once —
 * instead we execute each file as a sub-process via node --import.
 *
 * For use within a single process (e.g. with mitata's group/summary API if
 * upgraded), each import is dynamic so they execute in sequence.
 *
 * Usage:
 *   node --allow-natives-syntax --expose-gc src/benchmarks/all.bench.ts
 * Or via tsx / ts-node:
 *   tsx src/benchmarks/all.bench.ts
 */

const modules = [
  './Ref.bench.js',
  './Queue.bench.js',
  './MemoryPool.bench.js',
  './BatchExecutor.bench.js',
  './Memoization.bench.js',
  './FunctionUtils.bench.js',
  './HTML.bench.js',
  './Immutable.bench.js',
  './JSON.bench.js',
  './ErrorChain.bench.js',
  './Deferred.bench.js',
  './SOA.bench.js',
  './BufferizedFunction.bench.js',
  './ManagedResource.bench.js',
  './PromiseUtils.bench.js',
  './FunctionReference.bench.js',
] as const

console.log('=== vjuga benchmark suite ===\n')

for (const mod of modules) {
  const name = mod.replace('./', '').replace('.bench.js', '')
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${name}`)
  console.log('─'.repeat(60))
  // Dynamic import runs each file's top-level await (including run()) in sequence
  await import(mod)
}

console.log('\n=== all benchmarks complete ===')

export {}
