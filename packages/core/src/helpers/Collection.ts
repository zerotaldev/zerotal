/**
 * Fluent wrapper around an array. Chain transformations
 * ({@link Collection.map | map}, {@link Collection.filter | filter},
 * {@link Collection.where | where}, {@link Collection.pluck | pluck}, …), read
 * aggregates ({@link Collection.sum | sum}, {@link Collection.first | first}, …),
 * and unwrap with {@link Collection.toArray | toArray}. Most methods return a NEW
 * `Collection`, leaving the original untouched, so chains read top-to-bottom.
 *
 * Create one with the {@link collect} helper. Extend all instances at once with
 * the static {@link Collection.macro | macro}.
 *
 * @example
 * ```ts
 * const users = collect([
 *   { name: 'Alice', team: 'a', score: 90 },
 *   { name: 'Bob',   team: 'b', score: 70 },
 *   { name: 'Cara',  team: 'a', score: 85 },
 * ]);
 *
 * users
 *   .where('score', '>=', 80)   // keep Alice and Cara
 *   .map((u) => ({ ...u, name: u.name.toUpperCase() }))
 *   .pluck('name')              // Collection<string>
 *   .toArray();                 // ['ALICE', 'CARA']
 * ```
 */
export class Collection<T> {
  constructor(private _items: T[]) {}

  // ── Transformation ────────────────────────────────────────────────────────

  /**
   * Map every item through `fn`, returning a new Collection of the results.
   * @category Transformation
   */
  map<U>(fn: (item: T, index: number) => U): Collection<U> {
    return new Collection(this._items.map(fn));
  }

  /**
   * Map each item to an array and flatten the results one level.
   * @category Transformation
   */
  flatMap<U>(fn: (item: T, index: number) => U[]): Collection<U> {
    return new Collection(this._items.flatMap(fn));
  }

  /**
   * Keep only items for which `fn` returns truthy.
   * @category Transformation
   */
  filter(fn: (item: T, index: number) => boolean): Collection<T> {
    return new Collection(this._items.filter(fn));
  }

  /**
   * Inverse of {@link Collection.filter} — drop items for which `fn` returns truthy.
   * @category Transformation
   */
  reject(fn: (item: T, index: number) => boolean): Collection<T> {
    return new Collection(this._items.filter((item, i) => !fn(item, i)));
  }

  /**
   * Filter by a key/value pair (optionally with operator). With two arguments
   * the operator defaults to `=`; supported operators are `=`/`==`, `!=`/`<>`,
   * `>`, `>=`, `<`, `<=`.
   *
   * @category Transformation
   * @example
   * collect(users).where('active', true)
   * collect(orders).where('total', '>', 100)
   */
  where(key: keyof T, operatorOrValue: unknown, value?: unknown): Collection<T> {
    let operator: string;
    let comparand: unknown;
    if (value === undefined) {
      operator = "=";
      comparand = operatorOrValue;
    } else {
      operator = String(operatorOrValue);
      comparand = value;
    }

    return this.filter((item) => {
      const actual = (item as Record<string, unknown>)[String(key)];
      switch (operator) {
        case "=":
        case "==":
          return actual === comparand;
        case "!=":
        case "<>":
          return actual !== comparand;
        case ">":
          return (actual as number) > (comparand as number);
        case ">=":
          return (actual as number) >= (comparand as number);
        case "<":
          return (actual as number) < (comparand as number);
        case "<=":
          return (actual as number) <= (comparand as number);
        default:
          return actual === comparand;
      }
    });
  }

  /**
   * Filter to items whose key value is in the list.
   * @category Transformation
   */
  whereIn<K extends keyof T>(key: K, values: T[K][]): Collection<T> {
    return this.filter((item) => values.includes(item[key]));
  }

  /**
   * Filter to items whose key value is NOT in the list.
   * @category Transformation
   */
  whereNotIn<K extends keyof T>(key: K, values: T[K][]): Collection<T> {
    return this.filter((item) => !values.includes(item[key]));
  }

  /**
   * Extract one key from each item into a new Collection of those values.
   * @category Transformation
   */
  pluck<K extends keyof T>(key: K): Collection<T[K]> {
    return new Collection(this._items.map((item) => item[key]));
  }

  /**
   * Group items into a plain object keyed by a property or callback result.
   * @category Transformation
   */
  groupBy<K extends string>(keyOrFn: keyof T | ((item: T) => K)): Record<K, T[]> {
    const fn: (item: T) => K =
      typeof keyOrFn === "function"
        ? (keyOrFn as (item: T) => K)
        : (item) => String((item as Record<string, unknown>)[String(keyOrFn)]) as K;

    const result = {} as Record<K, T[]>;
    for (const item of this._items) {
      const groupKey = fn(item);
      if (!result[groupKey]) result[groupKey] = [];
      result[groupKey].push(item);
    }
    return result;
  }

  /**
   * Index items into a plain object keyed by a property — last duplicate wins.
   * @category Transformation
   */
  keyBy<K extends keyof T>(key: K): Record<string, T> {
    const result: Record<string, T> = {};
    for (const item of this._items) {
      result[String(item[key])] = item;
    }
    return result;
  }

  /**
   * Return a new Collection sorted by a key, ascending by default.
   * @category Transformation
   */
  sortBy<K extends keyof T>(key: K, direction: "asc" | "desc" = "asc"): Collection<T> {
    const sorted = [...this._items].sort((a, b) => {
      const valueA = a[key] as unknown;
      const valueB = b[key] as unknown;
      if (valueA === valueB) return 0;
      const comparison = (valueA as number) < (valueB as number) ? -1 : 1;
      return direction === "asc" ? comparison : -comparison;
    });
    return new Collection(sorted);
  }

  /**
   * Remove duplicate values (for primitive collections) or by key.
   * @category Transformation
   */
  unique(key?: keyof T): Collection<T> {
    if (!key) {
      return new Collection([...new Set(this._items)]);
    }
    const seen = new Set<unknown>();
    return this.filter((item) => {
      const keyValue = item[key];
      if (seen.has(keyValue)) return false;
      seen.add(keyValue);
      return true;
    });
  }

  /**
   * Split into a Collection of arrays, each at most `size` items long.
   * @category Transformation
   */
  chunk(size: number): Collection<T[]> {
    const result: T[][] = [];
    for (let start = 0; start < this._items.length; start += size) {
      result.push(this._items.slice(start, start + size));
    }
    return new Collection(result);
  }

  /**
   * Flatten a Collection of arrays one level deep.
   * @category Transformation
   */
  flatten(): Collection<T extends unknown[] ? T[number] : T> {
    return new Collection(
      (this._items as unknown[]).flat() as (T extends unknown[] ? T[number] : T)[],
    );
  }

  /**
   * Return a new Collection with the items in reverse order.
   * @category Transformation
   */
  reverse(): Collection<T> {
    return new Collection([...this._items].reverse());
  }

  /**
   * Take the first `count` items as a new Collection, or — when called with no
   * argument — return the single first item (or undefined).
   * @category Transformation
   */
  take<N extends number | undefined = undefined>(
    count?: N,
  ): N extends undefined ? T | undefined : Collection<T> {
    if (count === undefined) return this._items[0] as never;
    return new Collection(this._items.slice(0, count)) as never;
  }

  /**
   * Skip the first `count` items, returning the rest as a new Collection.
   * @category Transformation
   */
  skip(count: number): Collection<T> {
    return new Collection(this._items.slice(count));
  }

  /**
   * Run `fn` for each item (for side effects) and return the same Collection.
   * @category Access
   */
  each(fn: (item: T, index: number) => void): this {
    this._items.forEach(fn);
    return this;
  }

  // ── Aggregates ────────────────────────────────────────────────────────────

  /**
   * The number of items.
   * @category Aggregation
   */
  count(): number {
    return this._items.length;
  }

  /**
   * Whether the collection has no items.
   * @category Aggregation
   */
  isEmpty(): boolean {
    return this._items.length === 0;
  }
  /**
   * Whether the collection has at least one item.
   * @category Aggregation
   */
  isNotEmpty(): boolean {
    return this._items.length > 0;
  }

  /**
   * The first item (optionally the first matching `fn`), or undefined.
   * @category Access
   */
  first(fn?: (item: T) => boolean): T | undefined {
    return fn ? this._items.find(fn) : this._items[0];
  }

  /**
   * The last item (optionally the last matching `fn`), or undefined.
   * @category Access
   */
  last(fn?: (item: T) => boolean): T | undefined {
    if (fn) {
      const matches = this._items.filter(fn);
      return matches[matches.length - 1];
    }
    return this._items[this._items.length - 1];
  }

  /**
   * Sum the items, or the numeric value at `key` on each item.
   * @category Aggregation
   */
  sum(key?: keyof T): number {
    if (key) {
      return this._items.reduce((acc, item) => acc + Number(item[key]), 0);
    }
    return (this._items as unknown as number[]).reduce((a, b) => a + b, 0);
  }

  /**
   * The mean of the items (or of `key` on each item); `0` when empty.
   * @category Aggregation
   */
  avg(key?: keyof T): number {
    if (this._items.length === 0) return 0;
    return this.sum(key) / this._items.length;
  }

  /**
   * The smallest value (or smallest `key` value); `0` when empty.
   * @category Aggregation
   */
  min(key?: keyof T): number {
    if (this._items.length === 0) return 0;
    if (key) return Math.min(...this._items.map((item) => Number(item[key])));
    return Math.min(...(this._items as unknown as number[]));
  }

  /**
   * The largest value (or largest `key` value); `0` when empty.
   * @category Aggregation
   */
  max(key?: keyof T): number {
    if (this._items.length === 0) return 0;
    if (key) return Math.max(...this._items.map((item) => Number(item[key])));
    return Math.max(...(this._items as unknown as number[]));
  }

  /**
   * Whether the collection contains a value, or any item matching a predicate.
   * @category Access
   */
  contains(valueOrFn: T | ((item: T) => boolean)): boolean {
    if (typeof valueOrFn === "function") {
      return this._items.some(valueOrFn as (item: T) => boolean);
    }
    return this._items.includes(valueOrFn);
  }

  // ── Output ────────────────────────────────────────────────────────────────

  /**
   * A shallow copy of the underlying items as a plain array.
   * @category Conversion
   */
  toArray(): T[] {
    return [...this._items];
  }

  /**
   * The items serialized to a JSON string.
   * @category Conversion
   */
  toJson(): string {
    return JSON.stringify(this._items);
  }

  /**
   * A shallow copy of the items (alias of {@link Collection.toArray}).
   * @category Conversion
   */
  values(): T[] {
    return [...this._items];
  }

  /**
   * The number of items (property form of {@link Collection.count}).
   * @category Aggregation
   */
  get length(): number {
    return this._items.length;
  }

  /**
   * Iterate the items directly, e.g. in a `for...of` loop or spread.
   * @category Conversion
   */
  [Symbol.iterator](): Iterator<T> {
    return this._items[Symbol.iterator]();
  }

  // ── Macros ────────────────────────────────────────────────────────────────

  /**
   * Register a macro (custom method) on all Collection instances.
   *
   * The function is added to `Collection.prototype`, so it is available on
   * every `collect()` result immediately. Use `this` inside the function to
   * access the collection's own methods (`this.filter()`, `this.map()`, etc.).
   *
   * Add a module augmentation to your project for full TypeScript type safety:
   *
   * @example
   * // In AppServiceProvider.onBooted():
   * Collection.macro('filterActive', function(this: Collection<{ active: boolean }>) {
   *   return this.filter((item) => item.active);
   * });
   *
   * // In types.d.ts (for type safety):
   * declare module '@zerotal/core' {
   *   interface Collection<T> {
   *     filterActive(): Collection<T & { active: boolean }>;
   *   }
   * }
   *
   * // In a controller:
   * const active = collect(users).filterActive();
   *
   * @category Mutation
   */
  static macro(name: string, fn: (this: Collection<unknown>, ...args: unknown[]) => unknown): void {
    (Collection.prototype as unknown as Record<string, unknown>)[name] = fn;
  }
}

/**
 * Create a Collection from an array.
 *
 * @example
 * const users = collect([{ name: 'Alice', score: 90 }, { name: 'Bob', score: 70 }]);
 * users.where('score', '>', 80).pluck('name').first(); // 'Alice'
 */
export function collect<T>(items: T[]): Collection<T> {
  return new Collection(items);
}
