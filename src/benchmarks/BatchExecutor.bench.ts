declare const Bun: any
declare const process: { memoryUsage(): { heapUsed: number } }

import { bench, run } from 'mitata'
import { reportOptimizationStatus } from './_v8.js'
import * as BatchExecutor from '../BatchExecutor.js'

const gc = (): void => {
  if (typeof Bun !== 'undefined') Bun.gc(true)
  else if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc()
}

// Helper: create a batch executor that echoes inputs
function makeEchoExecutor() {
  return BatchExecutor.make<number, number>(async (args) => {
    return args.map((v) => ({ status: 'fulfilled' as const, value: v }))
  })
}

// --- Warm-up ---
{
  const exec = makeEchoExecutor()
  const warmupPromises: Promise<number>[] = []
  for (let i = 0; i < 100_000; i++) {
    warmupPromises.push(exec(i))
  }
  await Promise.all(warmupPromises)
  reportOptimizationStatus(makeEchoExecutor, 'BatchExecutor.make')
}

// --- Benchmarks ---

bench('BatchExecutor: single item batch (1 call, awaited)', async () => {
  const exec = makeEchoExecutor()
  return exec(42)
})

bench('BatchExecutor: small batch (10 concurrent calls)', async () => {
  const exec = makeEchoExecutor()
  const promises: Promise<number>[] = []
  for (let i = 0; i < 10; i++) promises.push(exec(i))
  return Promise.all(promises)
})

bench('BatchExecutor: medium batch (100 concurrent calls)', async () => {
  const exec = makeEchoExecutor()
  const promises: Promise<number>[] = []
  for (let i = 0; i < 100; i++) promises.push(exec(i))
  return Promise.all(promises)
})

bench('BatchExecutor: large batch (500 concurrent calls)', async () => {
  const exec = makeEchoExecutor()
  const promises: Promise<number>[] = []
  for (let i = 0; i < 500; i++) promises.push(exec(i))
  return Promise.all(promises)
})

bench('BatchExecutor: multiple sequential batches (10 batches of 10)', async () => {
  const exec = makeEchoExecutor()
  for (let batch = 0; batch < 10; batch++) {
    const promises: Promise<number>[] = []
    for (let i = 0; i < 10; i++) promises.push(exec(i))
    await Promise.all(promises)
  }
})

bench('BatchExecutor: batch with rejection handling', async () => {
  const exec = BatchExecutor.make<number, number>(async (args) => {
    return args.map((v, i) =>
      i % 2 === 0
        ? { status: 'fulfilled' as const, value: v }
        : { status: 'rejected' as const, reason: new Error('rejected') }
    )
  })
  const promises = [exec(1), exec(2), exec(3), exec(4)]
  return Promise.allSettled(promises)
})

await run()

// --- Memory benchmark ---
gc()
const heapBefore = process.memoryUsage().heapUsed
const exec = makeEchoExecutor()
const memPromises: Promise<number>[] = []
for (let i = 0; i < 10_000; i++) {
  memPromises.push(exec(i))
}
await Promise.all(memPromises)
gc()
const heapAfter = process.memoryUsage().heapUsed
console.log(`[memory] 10k BatchExecutor calls: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`)
