/**
 * Fast queue based on a circular buffer.
 *
 * @template T
 */
export class Queue {
  /**
   * `#head` is the index of the first element in the list.
   */
  #head = 0;
  /**
   * `#tail` points to an index where new items are pushed (i.e. tail points to the next free slot).
   */
  #tail = 0;

  #capacityMask = 0x3;

  /**
   * @type {Array<T | undefined>}
   * @readonly
   */
  #list = Array(4);

  /**
   * @constructor
   * @param {Iterable<T>} [values]
   */
  constructor(values) {
    if (values === undefined) return;
    for (const value of values) {
      this.push(value);
    }
  }

  /**
   * Current size of the queue.
   */
  get size() {
    if (this.#tail === this.#head) {
      return 0;
    }
    if (this.#tail > this.#head) {
      return this.#tail - this.#head;
    }
    return this.#list.length - this.#head + this.#tail;
  }

  /**
   *
   * @param {T} value
   */
  push(value) {
    const list = this.#list;
    list[this.#tail] = value;
    this.#tail = (this.#tail + 1) & this.#capacityMask;

    if (this.#tail === this.#head) {
      this.growList();
    }
  }

  pop() {
    if (this.#tail === this.#head) {
      return void 0;
    }
    const list = this.#list;
    this.#tail = (this.#tail - 1 + list.length) & this.#capacityMask;
    const value = list[this.#tail];
    list[this.#tail] = void 0;
    this.tryToShrinkList();
    return value;
  }

  /**
   * @private
   */
  tryToShrinkList() {
    const list = this.#list;
    if (
      list.length > 10000 &&
      this.#tail > this.#head &&
      this.#tail - this.#head < list.length >> 2
    ) {
      Array.prototype.copyWithin.call(list, 0, this.#head, this.#tail);
      this.#tail = this.#tail - this.#head;
      this.#head = 0;
      this.#capacityMask = (this.#capacityMask >> 1) | 1;
      list.length >>>= 1;
      Array.prototype.fill.call(list, void 0, this.#tail, list.length);
    }
  }

  /**
   * Pops the item from the head of the list.
   * @returns {T | undefined}
   */
  shift() {
    if (this.#tail === this.#head) {
      return undefined;
    }
    const list = this.#list;
    const value = list[this.#head];
    list[this.#head] = void 0;
    this.#head = (this.#head + 1) & this.#capacityMask;

    this.tryToShrinkList();
    return value;
  }

  /**
   * @private
   */
  growList() {
    const list = this.#list;
    const len = list.length;
    list.length = list.length << 1;
    this.#capacityMask = (this.#capacityMask << 1) | 1;

    Array.prototype.copyWithin.call(list, len, 0, this.#tail);
    Array.prototype.fill.call(list, void 0, 0, this.#tail);

    this.#tail = (this.#head + len) & this.#capacityMask;
  }

  /**
   * Pushes the item to the head of the list.
   * @param {T} value
   */
  unshift(value) {
    const list = this.#list;
    this.#head = (this.#head - 1 + list.length) & this.#capacityMask;
    list[this.#head] = value;

    if (this.#tail === this.#head) {
      this.growList();
    }
  }

  /**
   * Returns new list with all items in the queue. Queue is not cleared.
   */
  toArray() {
    const list = /** @type {Array<T>} */ (this.#list);
    const head = this.#head;
    const tail = this.#tail;

    /**
     * @type {Array<T>}
     */
    const result = Array(this.size);

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

    return result;
  }

  /**
   * Returns new list with all items in the queue. Queue is cleared.
   */
  dumpToArray() {
    const list = this.#list;
    const head = this.#head;
    const tail = this.#tail;

    /**
     * @type {Array<T>}
     */
    const result = Array(this.size);

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
    this.#head = 0;
    this.#tail = 0;
    return result;
  }

  /**
   * Static method 'from' creates new Queue instance from elements of any
   * iterable value passed to it.
   *
   * @template T
   * @param {Iterable<T>} values
   * @returns {Queue<T>}
   */
  static from(values) {
    return new Queue(values);
  }
}
