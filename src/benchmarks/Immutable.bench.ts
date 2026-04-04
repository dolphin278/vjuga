declare const Bun: any
declare const process: { memoryUsage(): { heapUsed: number } }

import { bench, run } from 'mitata'
import { reportOptimizationStatus } from './_v8.js'
import { make } from '../Immutable.js'

const gc = (): void => {
  if (typeof Bun !== 'undefined') Bun.gc(true)
  else if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc()
}

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    make({ x: i, y: i * 2 })
    make([1, 2, 3])
    make(i)
  }
  reportOptimizationStatus(make, 'Immutable.make')
}

// --- Benchmarks ---
// Note: Immutable.make is a type-cast-only function — it returns the value as-is.
// Benchmarks measure the call overhead vs direct assignment.

bench('Immutable.make: plain object', () => {
  return make({ x: 1, y: 2, z: 3 })
})

bench('Immutable.make: array', () => {
  return make([1, 2, 3, 4, 5])
})

bench('Immutable.make: primitive number', () => {
  return make(42)
})

bench('Immutable.make: string', () => {
  return make('hello world')
})

bench('Immutable.make: nested object', () => {
  return make({ a: { b: { c: 1 } } })
})

bench('Immutable.make: Map', () => {
  return make(new Map([['key', 'value']]))
})

bench('Immutable.make: Set', () => {
  return make(new Set([1, 2, 3]))
})

bench('baseline: plain object assignment (no make)', () => {
  const obj: Readonly<{ x: number; y: number }> = { x: 1, y: 2 }
  return obj
})

await run()

// --- Memory benchmark ---
gc()
const heapBefore = process.memoryUsage().heapUsed
const immutables: unknown[] = []
for (let i = 0; i < 100_000; i++) {
  immutables.push(make({ id: i, value: `item-${i}` }))
}
gc()
const heapAfter = process.memoryUsage().heapUsed
console.log(`[memory] 100k Immutable.make(object): ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`)
void immutables
