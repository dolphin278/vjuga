const kCapacityMask: unique symbol = Symbol("capacityMask");
const kHead: unique symbol = Symbol("head");
const kTail: unique symbol = Symbol("tail");
const kList: unique symbol = Symbol("list");

export interface Queue<T> {
  [kCapacityMask]: number;
  [kHead]: number;
  [kTail]: number;
  [kList]: Array<T | undefined>;
}

export function make<T>(items?: Iterable<T>): Queue<T> {
  const queue: Queue<T> = {
    [kCapacityMask]: 0x3,
    [kHead]: 0,
    [kTail]: 0,
    [kList]: Array(4),
  };
  // Write kCapacityMask a second time so V8 marks it as a mutable field from
  // the very first make() call. growList() writes to kCapacityMask on every
  // resize; without this, the first resize triggers a cascade deoptimization
  // of every compiled Queue function — V8 assumed the field was const because
  // it was only written once (during object literal construction).
  queue[kCapacityMask] = 0x3;

  if (items !== undefined) {
    for (const value of items) {
      push(queue, value);
    }
  }

  return queue;
}

export function size<T>(queue: Queue<T>): number {
  // Branchless circular-buffer size:
  //   tail=head  → (0 + len) & (len-1) = 0       (len is always a power of 2)
  //   tail>head  → (t-h + len) & (len-1) = t-h
  //   tail<head  → (t-h + len) & (len-1) = len-h+t
  return (queue[kTail] - queue[kHead] + queue[kList].length) & queue[kCapacityMask];
}

export function push<T>(queue: Queue<T>, value: T): void {
  const list = queue[kList];
  list[queue[kTail]] = value;
  queue[kTail] = (queue[kTail] + 1) & queue[kCapacityMask];

  if (queue[kTail] === queue[kHead]) {
    growList(queue);
  }
}

export function pop<T>(queue: Queue<T>): T | undefined {
  if (queue[kTail] === queue[kHead]) {
    return void 0;
  }
  const list = queue[kList];
  queue[kTail] = (queue[kTail] - 1 + list.length) & queue[kCapacityMask];
  const value = list[queue[kTail]];
  list[queue[kTail]] = void 0;
  if (list.length > 10000) tryToShrinkList(queue);
  return value;
}

export function tryToShrinkList<T>(queue: Queue<T>): void {
  const list = queue[kList];
  if (
    list.length > 10000 &&
    queue[kTail] > queue[kHead] &&
    queue[kTail] - queue[kHead] < list.length >> 2
  ) {
    Array.prototype.copyWithin.call(list, 0, queue[kHead], queue[kTail]);
    queue[kTail] = queue[kTail] - queue[kHead];
    queue[kHead] = 0;
    queue[kCapacityMask] = (queue[kCapacityMask] >> 1) | 1;
    list.length >>>= 1;
    Array.prototype.fill.call(list, void 0, queue[kTail], list.length);
  }
}

export function growList<T>(queue: Queue<T>): void {
  const list = queue[kList];
  const len = list.length;
  list.length = list.length << 1;
  queue[kCapacityMask] = (queue[kCapacityMask] << 1) | 1;

  Array.prototype.copyWithin.call(list, len, 0, queue[kTail]);
  Array.prototype.fill.call(list, void 0, 0, queue[kTail]);

  queue[kTail] = (queue[kHead] + len) & queue[kCapacityMask];
}

export function shift<T>(queue: Queue<T>): T | undefined {
  if (queue[kTail] === queue[kHead]) {
    return undefined;
  }
  const list = queue[kList];
  const value = list[queue[kHead]];
  list[queue[kHead]] = void 0;
  queue[kHead] = (queue[kHead] + 1) & queue[kCapacityMask];

  if (list.length > 10000) tryToShrinkList(queue);
  return value;
}

export function unshift<T>(queue: Queue<T>, value: T): void {
  const list = queue[kList];
  queue[kHead] = (queue[kHead] - 1 + list.length) & queue[kCapacityMask];
  list[queue[kHead]] = value;

  if (queue[kTail] === queue[kHead]) {
    growList(queue);
  }
}

export function toArray<T>(queue: Queue<T>): Array<T> {
  const list = queue[kList];
  const head = queue[kHead];
  const tail = queue[kTail];

  const result: Array<T | undefined> = Array((tail - head + list.length) & queue[kCapacityMask]);

  if (tail >= head) {
    for (let i = head; i < tail; i++) {
      result[i - head] = list[i];
    }
  } else {
    for (let i = head; i < list.length; i++) {
      result[i - head] = list[i];
    }
    for (let i = 0; i < tail; i++) {
      result[i + list.length - head] = list[i];
    }
  }

  return result as Array<T>;
}

export function dumpToArray<T>(queue: Queue<T>): Array<T> {
  const list = queue[kList];
  const head = queue[kHead];
  const tail = queue[kTail];

  const result: Array<T> = Array((tail - head + list.length) & queue[kCapacityMask]);

  if (tail >= head) {
    for (let i = head; i < tail; i++) {
      result[i - head] = list[i] as T;
      list[i] = void 0;
    }
  } else {
    for (let i = head; i < list.length; i++) {
      result[i - head] = list[i] as T;
      list[i] = void 0;
    }
    for (let i = 0; i < tail; i++) {
      result[i + list.length - head] = list[i] as T;
      list[i] = void 0;
    }
  }
  queue[kHead] = 0;
  queue[kTail] = 0;
  return result;
}
