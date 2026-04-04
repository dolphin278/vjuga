declare const Bun: any
declare const process: { memoryUsage(): { heapUsed: number } }

import { bench, run } from 'mitata'
import { reportOptimizationStatus } from './_v8.js'
import { chain, toArray, find } from '../ErrorChain.js'

const gc = (): void => {
  if (typeof Bun !== 'undefined') Bun.gc(true)
  else if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc()
}

// Build chains of various depths
const makeChain = (depth: number): Error => {
  let err: Error | undefined
  for (let i = 0; i < depth; i++) {
    err = new Error(`Error level ${i}`, { cause: err })
  }
  return err!
}

const chain1 = makeChain(1)
const chain3 = makeChain(3)
const chain10 = makeChain(10)

class NetworkError extends Error { name = 'NetworkError' }
class DatabaseError extends Error { name = 'DatabaseError' }
const mixedChain = new NetworkError('net fail', {
  cause: new DatabaseError('db fail', {
    cause: new Error('root cause'),
  }),
})

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    toArray(chain3)
    find((e) => e instanceof Error, chain3)
  }
  reportOptimizationStatus(toArray, 'ErrorChain.toArray')
  reportOptimizationStatus(find, 'ErrorChain.find')
}

// --- Benchmarks ---

bench('ErrorChain.chain (generator, depth 1)', () => {
  return [...chain(chain1)]
})

bench('ErrorChain.chain (generator, depth 3)', () => {
  return [...chain(chain3)]
})

bench('ErrorChain.chain (generator, depth 10)', () => {
  return [...chain(chain10)]
})

bench('ErrorChain.toArray (depth 1)', () => {
  return toArray(chain1)
})

bench('ErrorChain.toArray (depth 3)', () => {
  return toArray(chain3)
})

bench('ErrorChain.toArray (depth 10)', () => {
  return toArray(chain10)
})

bench('ErrorChain.find: match first (depth 3)', () => {
  return find((e) => e instanceof Error, chain3)
})

bench('ErrorChain.find: match last (depth 3)', () => {
  return find((e) => (e as Error).message === 'Error level 0', chain3)
})

bench('ErrorChain.find: no match (depth 10)', () => {
  return find((e) => false, chain10)
})

bench('ErrorChain.find: mixed type chain — find specific type', () => {
  return find((e) => e instanceof DatabaseError, mixedChain)
})

bench('makeChain (3 levels)', () => {
  return makeChain(3)
})

await run()

// --- Memory benchmark ---
gc()
const heapBefore = process.memoryUsage().heapUsed
const chains: Error[] = []
for (let i = 0; i < 10_000; i++) {
  chains.push(makeChain(5))
}
gc()
const heapAfter = process.memoryUsage().heapUsed
console.log(`[memory] 10k error chains (depth 5): ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`)
void chains
