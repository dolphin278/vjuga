declare const Bun: any
declare const process: { memoryUsage(): { heapUsed: number } }

import { bench, run } from 'mitata'
import { reportOptimizationStatus } from './_v8.js'
import { props, propsMap } from '../PromiseUtils.js'

const gc = (): void => {
  if (typeof Bun !== 'undefined') Bun.gc(true)
  else if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc()
}

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    await props({ a: Promise.resolve(1), b: Promise.resolve(2) })
  }
  reportOptimizationStatus(props, 'PromiseUtils.props')
  reportOptimizationStatus(propsMap, 'PromiseUtils.propsMap')
}

// --- Benchmarks ---

bench('props: single field', async () => {
  return props({ a: Promise.resolve(1) })
})

bench('props: 3 fields', async () => {
  return props({
    a: Promise.resolve(1),
    b: Promise.resolve('hello'),
    c: Promise.resolve(true),
  })
})

bench('props: 10 fields', async () => {
  return props({
    a: Promise.resolve(1),
    b: Promise.resolve(2),
    c: Promise.resolve(3),
    d: Promise.resolve(4),
    e: Promise.resolve(5),
    f: Promise.resolve(6),
    g: Promise.resolve(7),
    h: Promise.resolve(8),
    i: Promise.resolve(9),
    j: Promise.resolve(10),
  })
})

bench('props: mix of resolved promises and plain values', async () => {
  // plain values are treated like already-resolved promises by Promise.all
  return props({
    a: Promise.resolve(1),
    b: 'plain string' as any,
    c: Promise.resolve(true),
  })
})

bench('props vs Promise.all baseline (3 fields)', async () => {
  const [a, b, c] = await Promise.all([
    Promise.resolve(1),
    Promise.resolve('hello'),
    Promise.resolve(true),
  ])
  return { a, b, c }
})

bench('propsMap: 3 entries', async () => {
  const map = new Map<string, Promise<number>>([
    ['a', Promise.resolve(1)],
    ['b', Promise.resolve(2)],
    ['c', Promise.resolve(3)],
  ])
  return propsMap(map)
})

bench('propsMap: 10 entries', async () => {
  const map = new Map<string, Promise<number>>(
    Array.from({ length: 10 }, (_, i) => [`key${i}`, Promise.resolve(i)])
  )
  return propsMap(map)
})

bench('propsMap: empty map', async () => {
  return propsMap(new Map())
})

bench('propsMap vs props: 5 fields (comparison)', async () => {
  // propsMap version
  const map = new Map<string, Promise<number>>([
    ['a', Promise.resolve(1)], ['b', Promise.resolve(2)],
    ['c', Promise.resolve(3)], ['d', Promise.resolve(4)],
    ['e', Promise.resolve(5)],
  ])
  return propsMap(map)
})

await run()

// --- Memory benchmark ---
gc()
const heapBefore = process.memoryUsage().heapUsed
const results: object[] = []
for (let i = 0; i < 10_000; i++) {
  results.push(await props({
    a: Promise.resolve(i),
    b: Promise.resolve(i * 2),
    c: Promise.resolve(i * 3),
  }))
}
gc()
const heapAfter = process.memoryUsage().heapUsed
console.log(`[memory] 10k props({3 fields}) calls: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`)
void results
