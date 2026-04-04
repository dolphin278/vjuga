declare const Bun: any
declare const process: { memoryUsage(): { heapUsed: number } }

import { bench, run } from 'mitata'
import { reportOptimizationStatus } from './_v8.js'
import { createView, push, pop, get, set, getSlice } from '../SOA.js'

const gc = (): void => {
  if (typeof Bun !== 'undefined') Bun.gc(true)
  else if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc()
}

type Particle = { x: number; y: number; vx: number; vy: number }

function makeParticleSOA() {
  return { x: [] as number[], y: [] as number[], vx: [] as number[], vy: [] as number[] }
}

// --- Warm-up ---
{
  const soa = makeParticleSOA()
  for (let i = 0; i < 100_000; i++) {
    push(soa, { x: i, y: i * 2, vx: 1, vy: 1 })
  }
  for (let i = 0; i < 100_000; i++) {
    get(soa, i % 100_000)
  }
  reportOptimizationStatus(push, 'SOA.push')
  reportOptimizationStatus(get, 'SOA.get')
  reportOptimizationStatus(set, 'SOA.set')
  reportOptimizationStatus(createView, 'SOA.createView')
}

// --- Benchmarks ---

bench('SOA.push (single item)', () => {
  const soa = makeParticleSOA()
  push(soa, { x: 1, y: 2, vx: 0.5, vy: 0.3 })
})

bench('SOA.push x100', () => {
  const soa = makeParticleSOA()
  for (let i = 0; i < 100; i++) {
    push(soa, { x: i, y: i, vx: 1, vy: 1 })
  }
})

bench('SOA.pop (from 10-item SOA)', () => {
  const soa = makeParticleSOA()
  for (let i = 0; i < 10; i++) push(soa, { x: i, y: i, vx: 1, vy: 1 })
  return pop(soa)
})

bench('SOA.get (index lookup)', () => {
  const soa = makeParticleSOA()
  for (let i = 0; i < 10; i++) push(soa, { x: i, y: i, vx: 1, vy: 1 })
  return get(soa, 5)
})

bench('SOA.set (index update)', () => {
  const soa = makeParticleSOA()
  for (let i = 0; i < 10; i++) push(soa, { x: i, y: i, vx: 1, vy: 1 })
  set(soa, 5, { x: 99, y: 99, vx: 0, vy: 0 })
})

bench('SOA.getSlice (get array slice)', () => {
  const soa = makeParticleSOA()
  for (let i = 0; i < 10; i++) push(soa, { x: i, y: i, vx: 1, vy: 1 })
  return getSlice(soa, 'x')
})

bench('SOA.createView (create proxy view)', () => {
  const soa = makeParticleSOA()
  for (let i = 0; i < 10; i++) push(soa, { x: i, y: i, vx: 1, vy: 1 })
  return createView(soa, 3)
})

bench('SOA.createView: read property via view', () => {
  const soa = makeParticleSOA()
  for (let i = 0; i < 10; i++) push(soa, { x: i, y: i, vx: 1, vy: 1 })
  const view = createView(soa, 3)
  return view.x + view.y
})

bench('SOA.createView: write property via view', () => {
  const soa = makeParticleSOA()
  for (let i = 0; i < 10; i++) push(soa, { x: i, y: i, vx: 1, vy: 1 })
  const view = createView(soa, 3)
  view.x = 42
  view.y = 42
})

bench('SOA.createView: traverse 100 items via view index change', () => {
  const soa = makeParticleSOA()
  for (let i = 0; i < 100; i++) push(soa, { x: i, y: i, vx: 1, vy: 1 })
  const view = createView(soa, 0)
  let sum = 0
  for (let i = 0; i < 100; i++) {
    view.index = i
    sum += view.x
  }
  return sum
})

bench('AoS baseline: push 100 plain objects', () => {
  const arr: Particle[] = []
  for (let i = 0; i < 100; i++) arr.push({ x: i, y: i, vx: 1, vy: 1 })
  return arr
})

bench('AoS baseline: read 100 objects', () => {
  const arr: Particle[] = []
  for (let i = 0; i < 100; i++) arr.push({ x: i, y: i, vx: 1, vy: 1 })
  let sum = 0
  for (let i = 0; i < 100; i++) sum += arr[i].x
  return sum
})

await run()

// --- Memory benchmark ---
gc()
const heapBefore = process.memoryUsage().heapUsed
const soa = makeParticleSOA()
for (let i = 0; i < 100_000; i++) {
  push(soa, { x: i, y: i * 2, vx: Math.random(), vy: Math.random() })
}
gc()
const heapAfter = process.memoryUsage().heapUsed
console.log(`[memory] SOA with 100k Particle entries: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`)
void soa
