declare const Bun: any
declare const process: { memoryUsage(): { heapUsed: number } }

import { bench, run } from 'mitata'
import { reportOptimizationStatus } from './_v8.js'
import { make } from '../BufferizedFunction.js'

const gc = (): void => {
  if (typeof Bun !== 'undefined') Bun.gc(true)
  else if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc()
}

// --- Warm-up ---
{
  let sink: number[] = []
  const bufFn = make<number>((args) => { sink = args })
  for (let i = 0; i < 100_000; i++) {
    bufFn(i)
  }
  // wait one tick for the scheduled setTimeout to flush
  await new Promise<void>((r) => setTimeout(r, 0))
  reportOptimizationStatus(make, 'BufferizedFunction.make')
  void sink
}

// --- Benchmarks ---

bench('BufferizedFunction.make (factory only)', () => {
  return make<number>((args) => { void args })
})

bench('BufferizedFunction: single enqueue (no flush)', () => {
  // Measures just the cost of adding one item to the queue
  const bufFn = make<number>((args) => { void args })
  bufFn(1)
})

bench('BufferizedFunction: enqueue 10 items (no flush)', () => {
  const bufFn = make<number>((args) => { void args })
  for (let i = 0; i < 10; i++) bufFn(i)
})

bench('BufferizedFunction: enqueue 100 items (no flush)', () => {
  const bufFn = make<number>((args) => { void args })
  for (let i = 0; i < 100; i++) bufFn(i)
})

bench('BufferizedFunction: enqueue + flush (1 item)', async () => {
  return new Promise<void>((resolve) => {
    const bufFn = make<number>((args) => { void args; resolve() })
    bufFn(1)
  })
})

bench('BufferizedFunction: enqueue 10 + flush', async () => {
  return new Promise<void>((resolve) => {
    let called = false
    const bufFn = make<number>((args) => {
      if (!called) { called = true; resolve() }
      void args
    })
    for (let i = 0; i < 10; i++) bufFn(i)
  })
})

bench('BufferizedFunction: enqueue 100 + flush', async () => {
  return new Promise<void>((resolve) => {
    let called = false
    const bufFn = make<number>((args) => {
      if (!called) { called = true; resolve() }
      void args
    })
    for (let i = 0; i < 100; i++) bufFn(i)
  })
})

bench('BufferizedFunction: multiple separate flushes (10 rounds of 10)', async () => {
  const bufFn = make<number>((args) => { void args })
  for (let round = 0; round < 10; round++) {
    for (let i = 0; i < 10; i++) bufFn(i)
    await new Promise<void>((r) => setTimeout(r, 0))
  }
})

await run()

// --- Memory benchmark ---
gc()
const heapBefore = process.memoryUsage().heapUsed
const sink2: number[][] = []
const bufFn = make<number>((args) => { sink2.push(args) })
for (let i = 0; i < 100_000; i++) bufFn(i)
await new Promise<void>((r) => setTimeout(r, 10))
gc()
const heapAfter = process.memoryUsage().heapUsed
console.log(`[memory] BufferizedFunction 100k enqueue+flush: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`)
void sink2
