/**
 * Fixed-capacity FIFO ring buffer. push() drops the oldest entry when full.
 * O(1) push, O(n) iteration.
 *
 * Implementation: a fixed-length array with a moving head/size index. The
 * previous implementation used `Array.splice(0, …)` to trim the oldest
 * entries which is O(n) per push and showed up as a hot path once the
 * buffer was full (≥ 57 600 snapshots × 4 Hz on the liquidity feed).
 */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  /** Index of the slot the next push will write to. */
  private head = 0;
  /** Current number of valid entries (≤ capacity). */
  private count = 0;

  constructor(public readonly capacity: number) {
    if (capacity <= 0) throw new Error("RingBuffer capacity must be > 0");
    this.buf = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  pushMany(items: T[]): void {
    for (const i of items) this.push(i);
  }

  size(): number {
    return this.count;
  }

  /** Returns a shallow snapshot of all items (oldest first). */
  toArray(): T[] {
    if (this.count === 0) return [];
    const out: T[] = new Array(this.count);
    // When `count < capacity` the data lives in [0..head); when full it
    // wraps starting at `head`.
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      out[i] = this.buf[(start + i) % this.capacity] as T;
    }
    return out;
  }

  /** Filter view; does not mutate. */
  filter(fn: (t: T) => boolean): T[] {
    const out: T[] = [];
    if (this.count === 0) return out;
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const v = this.buf[(start + i) % this.capacity] as T;
      if (fn(v)) out.push(v);
    }
    return out;
  }

  /**
   * Drop entries older than `cutoffTs` based on a getter. Entries are stored
   * in chronological order (push order), so we can advance the read pointer
   * until we hit an entry at or after `cutoffTs`.
   */
  prune(getTs: (t: T) => number, cutoffTs: number): void {
    if (this.count === 0) return;
    const start = this.count < this.capacity ? 0 : this.head;
    let drop = 0;
    while (drop < this.count) {
      const v = this.buf[(start + drop) % this.capacity] as T;
      if (getTs(v) >= cutoffTs) break;
      drop++;
    }
    if (drop === 0) return;
    if (drop === this.count) {
      this.clear();
      return;
    }
    // Clear dropped slots so we don't hold dangling references.
    for (let i = 0; i < drop; i++) {
      this.buf[(start + i) % this.capacity] = undefined;
    }
    this.count -= drop;
    // After pruning, the logical "start" of valid data is `(start + drop)
    // mod capacity`. We don't need a separate tail pointer because
    // `count < capacity` ⇒ data lives in [tail..head); the above loop
    // computes that correctly via `start`. Update bookkeeping so the
    // invariant `count < capacity ⇒ start = 0` holds: we re-pack into
    // slots [0, count) only when this is cheap enough — i.e., always —
    // because we've already paid O(count) above.
    if (this.count < this.capacity) {
      const newBuf = new Array<T | undefined>(this.capacity);
      for (let i = 0; i < this.count; i++) {
        newBuf[i] = this.buf[(start + drop + i) % this.capacity];
      }
      this.buf = newBuf;
      this.head = this.count;
    }
  }

  clear(): void {
    this.buf = new Array<T | undefined>(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}
