// ── Synthesizer registry ──────────────────────────────────────────────────────
//
// Each synthesizer knows how to:
//   - match a JS value at dehydration time
//   - convert it to a JSON-safe primitive + metadata object
//   - reconstruct the original value from that primitive + metadata
//
// Pattern lifted directly from Livewire v3's synthesizer system.

/**
 * A synthesizer ("synth") teaches flow how to send a non-JSON type across the
 * wire: it matches a live value, dehydrates it to a JSON-safe primitive plus
 * metadata for the snapshot, and hydrates it back on the other side.
 *
 * @remarks
 * This is the extension point behind first-class support for `Date`, `Carbon`,
 * ORM models, collections, and {@link TemporaryUploadedFile}. During
 * serialization the registry tries each synth's {@link match} in order; the first
 * match's {@link dehydrate} produces the stored data and its {@link key} is
 * written to `meta.s`. On the way back, {@link key} selects the synth whose
 * {@link hydrate} reconstructs the value. `hydrate` may be async (e.g. a model
 * synth re-fetches by id). The pattern is lifted from Livewire v3's synthesizers.
 *
 * @typeParam T - The live value type this synth handles.
 */
export interface Synth<T = unknown> {
  /** Short tag stored as `meta.s` in the snapshot, e.g. `'cbn'`, `'mdl'`. */
  key: string;
  /** Type guard: whether this synth handles `value` (checked in registration order). */
  match(value: unknown): value is T;
  /** Serialize `value` to a JSON-safe form; may mutate `meta` to stash extra fields for hydrate. */
  dehydrate(value: T, meta: Record<string, unknown>): unknown;
  /** Reconstruct the live value from serialized `data` and its `meta` (may be async). */
  hydrate(data: unknown, meta: Record<string, unknown>): T | Promise<T>;
}

const _synths: Synth[] = [];

/**
 * Register a synthesizer so its type can cross the wire in snapshots. Newly
 * registered synths are tried first, so a later registration can override an
 * earlier (built-in) match.
 *
 * @param synth - The {@link Synth} to add to the registry.
 *
 * @example
 * ```ts
 * class Money { constructor(public cents: number, public currency: string) {} }
 *
 * registerSynth({
 *   key: "money",
 *   match: (v): v is Money => v instanceof Money,
 *   dehydrate: (v, meta) => { meta.cur = v.currency; return v.cents; },
 *   hydrate: (data, meta) => new Money(data as number, meta.cur as string),
 * });
 * ```
 */
export function registerSynth(synth: Synth): void {
  _synths.unshift(synth); // user-registered synths take priority
}

/** The registered synths, in match order (most-recently-registered first). */
export function getSynths(): readonly Synth[] {
  return _synths;
}

/**
 * Serialize a single value through the synth registry, recursing into plain
 * arrays and objects (each element/property stored as its own `[data, meta]`
 * tuple so per-element synth metadata is preserved).
 *
 * @param value - The value to serialize.
 * @returns A `[data, meta]` tuple; `meta.s` names the synth that matched, if any.
 */
export function serializeValue(value: unknown): [data: unknown, meta: Record<string, unknown>] {
  const meta: Record<string, unknown> = {};

  for (const synth of _synths) {
    if (synth.match(value)) {
      const data = synth.dehydrate(value as never, meta);
      meta["s"] = synth.key;
      return [data, meta];
    }
  }

  // Recursive: plain arrays and objects.
  // Store full [data, meta] tuples per element so per-element synth metadata
  // (e.g. { s: 'mdl', class: 'Post' } for ORM models, Date, etc.) is preserved.
  if (Array.isArray(value)) {
    return [value.map((v) => serializeValue(v)), meta];
  }
  if (typeof value === "object" && value !== null) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      obj[k] = serializeValue(v);
    }
    return [obj, meta];
  }

  return [value, meta];
}

/**
 * Deserialize a `[data, meta]` tuple produced by {@link serializeValue} back into
 * a live value, recursing into plain arrays and objects.
 *
 * @param data - The serialized data.
 * @param meta - Its metadata; `meta.s`, when present, selects the synth to hydrate with.
 * @returns The reconstructed value.
 * @throws Error if `meta.s` names a synth key that isn't registered.
 */
export async function deserializeValue(
  data: unknown,
  meta: Record<string, unknown>,
): Promise<unknown> {
  const synthKey = meta["s"] as string | undefined;
  if (synthKey) {
    const synth = _synths.find((s) => s.key === synthKey);
    if (!synth) throw new Error(`[Flow] Unknown synth key: "${synthKey}"`);
    return synth.hydrate(data, meta);
  }

  // Recursive: plain arrays/objects (no synth key).
  // Each element/value is a [data, meta] tuple stored by serializeValue.
  if (Array.isArray(data)) {
    return Promise.all(
      data.map((item) =>
        Array.isArray(item) && item.length === 2
          ? deserializeValue(item[0], item[1] as Record<string, unknown>)
          : deserializeValue(item, {}),
      ),
    );
  }
  if (typeof data === "object" && data !== null) {
    const result: Record<string, unknown> = {};
    await Promise.all(
      Object.entries(data as Record<string, unknown>).map(async ([k, v]) => {
        result[k] =
          Array.isArray(v) && v.length === 2
            ? await deserializeValue(v[0], v[1] as Record<string, unknown>)
            : await deserializeValue(v, {});
      }),
    );
    return result;
  }

  return data;
}
