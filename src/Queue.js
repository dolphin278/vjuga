const kCapacityMask = Symbol("capacityMask");

const kHead = Symbol("head");

const kTail = Symbol("tail");

const kList = Symbol("list");

/**
 * @template T
 * @typedef {{
 *  [kCapacityMask]: number,
 *  [kHead]: number,
 *  [kTail]: number,
 *  [kList]: Array<T | undefined>,
 * }} Queue
 */

/**
 * @template T
 * @param {Iterable<T>} [items]
 */
export function make(items) {
  const queue = /** @type {Queue<T>} */ ({
    [kCapacityMask]: 0x3,
    [kHead]: 0,
    [kTail]: 0,
    [kList]: Array(4),
  });

  if (items !== undefined) {
    for (const value of items) {
      push(queue, value);
    }
  }

  return queue;
}

/**
 * @template T
 * @param {Queue<T>} queue
 */
export function size(queue) {
  const head = queue[kHead];
  const tail = queue[kTail];
  if (tail === head) {
    return 0;
  }
  if (tail > head) {
    return tail - head;
  }
  return queue[kList].length - head + tail;
}

/**
 * @template T
 * @param {Queue<T>} queue
 * @param {T} value
 */
export function push(queue, value) {
  const list = queue[kList];
  list[queue[kTail]] = value;
  queue[kTail] = (queue[kTail] + 1) & queue[kCapacityMask];

  if (queue[kTail] === queue[kHead]) {
    growList(queue);
  }
}

/**
 * @template T
 * @param {Queue<T>} queue
 * @returns {T | undefined}
 */
export function pop(queue) {
  if (queue[kTail] === queue[kHead]) {
    return void 0;
  }
  const list = queue[kList];
  queue[kTail] = (queue[kTail] - 1 + list.length) & queue[kCapacityMask];
  const value = list[queue[kTail]];
  list[queue[kTail]] = void 0;
  tryToShrinkList(queue);
  return value;
}

/**
 * @template T
 * @param {Queue<T>} queue
 */
export function tryToShrinkList(queue) {
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

/**
 * @template T
 * @param {Queue<T>} queue
 */
export function growList(queue) {
  const list = queue[kList];
  const len = list.length;
  list.length = list.length << 1;
  queue[kCapacityMask] = (queue[kCapacityMask] << 1) | 1;

  Array.prototype.copyWithin.call(list, len, 0, queue[kTail]);
  Array.prototype.fill.call(list, void 0, 0, queue[kTail]);

  queue[kTail] = (queue[kHead] + len) & queue[kCapacityMask];
}

/**
 * @template T
 * @param {Queue<T>} queue
 * @returns {T | undefined}
 */
export function shift(queue) {
  if (queue[kTail] === queue[kHead]) {
    return undefined;
  }
  const list = queue[kList];
  const value = list[queue[kHead]];
  list[queue[kHead]] = void 0;
  queue[kHead] = (queue[kHead] + 1) & queue[kCapacityMask];

  tryToShrinkList(queue);
  return value;
}

/**
 *
 * @template T
 * @param {Queue<T>} queue
 * @param {T} value
 */
export function unshift(queue, value) {
  const list = queue[kList];
  queue[kHead] = (queue[kHead] - 1 + list.length) & queue[kCapacityMask];
  list[queue[kHead]] = value;

  if (queue[kTail] === queue[kHead]) {
    growList(queue);
  }
}

/**
 * @template T
 * @param {Queue<T>} queue
 * @returns {Array<T>}
 */
export function toArray(queue) {
  const list = queue[kList];
  const head = queue[kHead];
  const tail = queue[kTail];

  /**
   * @type {Array<T | undefined>}
   */
  const result = Array(size(queue));

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

  return /** @type {Array<T>} */ (result);
}

/**
 *
 * @template T
 * @param {Queue<T>} queue
 */
export function dumpToArray(queue) {
  const list = queue[kList];
  const head = queue[kHead];
  const tail = queue[kTail];

  /**
   * @type {Array<T>}
   */
  const result = Array(size(queue));

  if (tail >= head) {
    for (let i = head; i < tail; i++) {
      const v = list[i];
      if (v !== undefined) {
        result[i - head] = v;
      }
      list[i] = void 0;
    }
  } else {
    for (let i = head; i < list.length; i++) {
      const v = list[i];
      if (v !== undefined) {
        result[i - head] = v;
      }
      list[i] = void 0;
    }
    for (let i = 0; i < tail; i++) {
      const v = list[i];
      if (v !== undefined) {
        result[i + list.length - head] = v;
      }
      list[i] = void 0;
    }
  }
  queue[kHead] = 0;
  queue[kTail] = 0;
  return result;
}
