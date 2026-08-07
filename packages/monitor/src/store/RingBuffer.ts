/**
 * A fixed-capacity rolling buffer of numeric samples, used for sparklines and
 * throughput series. Pushing past capacity drops the oldest sample — so the
 * buffer always represents the most recent `capacity` data points.
 */
export class RingBuffer {
  private readonly _values: number[];
  private readonly _capacity: number;

  constructor(capacity: number, fill = 0) {
    this._capacity = Math.max(1, capacity);
    this._values = Array.from({ length: this._capacity }, () => fill);
  }

  /** Append a sample, evicting the oldest if at capacity. */
  push(value: number): void {
    this._values.push(value);
    if (this._values.length > this._capacity) this._values.shift();
  }

  /** A copy of the current series, oldest → newest. */
  values(): number[] {
    return [...this._values];
  }

  /** The most recent sample, or 0 if empty. */
  last(): number {
    return this._values[this._values.length - 1] ?? 0;
  }

  /** Arithmetic mean of the series. */
  avg(): number {
    if (this._values.length === 0) return 0;
    return this._values.reduce((a, b) => a + b, 0) / this._values.length;
  }

  /** Sum of the series. */
  sum(): number {
    return this._values.reduce((a, b) => a + b, 0);
  }
}

/**
 * A simple sliding-window timestamped event log. Used to compute rates and
 * percentiles over a recent time window without unbounded memory growth.
 */
export class TimeWindow<T extends { t: number }> {
  private _items: T[] = [];
  private readonly _maxAgeMs: number;
  private readonly _maxItems: number;

  constructor(maxAgeMs: number, maxItems = 5000) {
    this._maxAgeMs = maxAgeMs;
    this._maxItems = maxItems;
  }

  add(item: T): void {
    this._items.push(item);
    if (this._items.length > this._maxItems) {
      this._items.splice(0, this._items.length - this._maxItems);
    }
    this._prune();
  }

  /** Items within `windowMs` of now (defaults to the full retained window). */
  within(windowMs = this._maxAgeMs): T[] {
    const cutoff = Date.now() - windowMs;
    return this._items.filter((i) => i.t >= cutoff);
  }

  all(): T[] {
    return [...this._items];
  }

  private _prune(): void {
    const cutoff = Date.now() - this._maxAgeMs;
    let i = 0;
    while (i < this._items.length && (this._items[i] as T).t < cutoff) i++;
    if (i > 0) this._items.splice(0, i);
  }
}

/** Compute a percentile (0..100) from a numeric sample set. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] as number);
}
