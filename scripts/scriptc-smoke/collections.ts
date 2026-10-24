import * as BitSet from "../../src/BitSet.js";
import * as LRUCache from "../../src/LRUCache.js";
import * as OrderedMap from "../../src/OrderedMap.js";
import * as Queue from "../../src/Queue.js";
import * as PriorityQueue from "../../src/PriorityQueue.js";
import * as Ref from "../../src/Ref.js";
import * as BloomFilter from "../../src/BloomFilter.js";

const bs = BitSet.make(100);
BitSet.set(bs, 3);
BitSet.set(bs, 70);
BitSet.toggle(bs, 4);
console.log(
  BitSet.get(bs, 3),
  BitSet.popcount(bs),
  BitSet.toArray(BitSet.not(BitSet.and(bs, bs))).length,
);

const lru = LRUCache.make<string, number>(2);
LRUCache.set(lru, "a", 1);
LRUCache.set(lru, "b", 2);
LRUCache.get(lru, "a");
LRUCache.set(lru, "c", 3);
console.log(LRUCache.has(lru, "b"), LRUCache.get(lru, "a"), LRUCache.size(lru));

const om = OrderedMap.make<number, string>();
for (const k of [5, 1, 9, 3]) OrderedMap.set(om, k, `v${k}`);
console.log(
  [...OrderedMap.keys(om)].join(","),
  OrderedMap.floor(om, 4)?.[0],
  OrderedMap.ceiling(om, 4)?.[0],
);
console.log([...OrderedMap.range(om, 2, 6)].map(([k, v]) => `${k}=${v}`).join(","));

const q = Queue.make<number>([1, 2, 3]);
Queue.push(q, 4);
Queue.unshift(q, 0);
console.log(Queue.shift(q), Queue.pop(q), Queue.size(q), Queue.toArray(q).join(","));

const pq = PriorityQueue.make<number>((a, b) => a - b, [5, 1, 4]);
PriorityQueue.push(pq, 2);
console.log(PriorityQueue.pop(pq), PriorityQueue.pop(pq), PriorityQueue.size(pq));

const ref = Ref.make(1);
Ref.set(ref, Ref.get(ref) + 1);
console.log(Ref.get(ref));

const bf = BloomFilter.make(100, 0.01);
BloomFilter.add(bf, "x");
console.log(BloomFilter.mightContain(bf, "x"), BloomFilter.count(bf), BloomFilter.hashCount(bf));

// Past 10000 items the queue shrinks on drain (tryToShrinkList): cover the
// non-wrapped case (plain push/shift) and the wrapped case (tail < head when
// the shrink fires: push 12000, shift 7000, push 6000 wraps the ring).
for (const wrap of [false, true]) {
  const big = Queue.make<number>();
  let sum = 0;
  if (wrap) {
    for (let i = 0; i < 12000; i++) Queue.push(big, i);
    for (let i = 0; i < 7000; i++) Queue.shift(big);
    for (let i = 0; i < 6000; i++) Queue.push(big, -i);
    for (let i = 0; i < 6910; i++) sum += Queue.shift(big) ?? 0;
    for (let i = 0; i < 20; i++) Queue.push(big, 100000 + i);
    console.log(Queue.toArray(big).slice(0, 3).join(","), Queue.toArray(big).slice(-3).join(","));
  }
  for (let i = 0; i < 20000; i++) Queue.push(big, i);
  for (let i = 0; i < 18000; i++) sum += Queue.shift(big) ?? 0;
  while (Queue.size(big) > 100) sum += Queue.pop(big) ?? 0;
  console.log(wrap, sum, Queue.size(big), Queue.peekFront(big), Queue.peekBack(big));
}
