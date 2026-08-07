// ── Decorator registration core (Bun 1.3.x standard-decorator workaround) ─────
//
// Bun 1.3.x mis-compiles standard TC39 field decorators: deferred work is corrupted
// and shared across every class defined in the same file. Specifically —
//   • field initializers and field `addInitializer` callbacks are cross-wired (a class
//     runs another class's initializers, and names captured in their closures resolve
//     to the LAST class defined in the file);
//   • `context.metadata` is a single object shared by every class in the file;
//   • `Symbol.metadata` is never assigned to the class.
//
// The ONE thing Bun compiles correctly is the decorator BODY: it runs synchronously at
// class-definition time with the correct `context.name`, but without a reference to the
// class. So each field/relation decorator captures its name+config in the body and
// ENQUEUES a registration closure. The `@table` class decorator runs synchronously right
// after a class's members — and it DOES receive the class — so it drains the queue into
// the concrete class. Result: every model anchors its columns/relations via `@table`.

import { relationRegistry } from "../relations/RelationRegistry.ts";
import type { RelationMetadata } from "../relations/RelationRegistry.ts";
import type { ColumnOptions } from "./column.ts";

/**
 * Per-class OWN column definitions. Readers walk the prototype chain to merge inherited.
 * @internal
 */
export const columnRegistry = new Map<Function, Map<string, ColumnOptions>>();

// ── Definition-time queue ─────────────────────────────────────────────────────

interface PendingMember {
  /** Field name (captured correctly in the decorator body). */
  name: string;
  apply: (ctor: Function) => void;
}
let _pending: PendingMember[] = [];

/**
 * Enqueue a member registration from a decorator body (name captured correctly there).
 * @internal
 */
export function enqueueMember(name: string, apply: (ctor: Function) => void): void {
  _pending.push({ name, apply });
}

/**
 * Drain queued member registrations into `ctor`. Called by the `@table` class decorator,
 * which runs synchronously immediately after the class's member decorators — so the queue
 * contains exactly that class's members and nothing else.
 * @internal
 */
export function drainPendingMembers(ctor: Function): void {
  if (_pending.length === 0) return;
  const batch = _pending;
  _pending = [];
  for (const e of batch) e.apply(ctor);
  registerModelName(ctor);
}

// ── Per-class registration (invoked from drained closures) ────────────────────

/**
 * Record a column definition for `ctor`, and mirror any `cast` onto the class's own
 * `static casts` map (seeded from the parent so a subclass extends rather than mutates it).
 * @internal
 */
export function registerColumn(ctor: Function, name: string, options: ColumnOptions): void {
  let m = columnRegistry.get(ctor);
  if (!m) {
    m = new Map();
    columnRegistry.set(ctor, m);
  }
  m.set(name, options);

  if (options.cast) {
    const c = ctor as { casts?: Record<string, ColumnOptions["cast"]> };
    // Give the class its OWN casts object (seeded from the parent) the first time we add
    // to it, so a subclass extends rather than mutates the parent's casts.
    if (!Object.prototype.hasOwnProperty.call(ctor, "casts")) {
      const parent = (
        Object.getPrototypeOf(ctor) as { casts?: Record<string, ColumnOptions["cast"]> }
      )?.casts;
      c.casts = { ...(parent ?? {}) };
    }
    c.casts![name] = options.cast;
  }
}

/**
 * Record relation metadata for `ctor`. Invoked from a drained decorator closure.
 * @internal
 */
export function registerRelation(ctor: Function, name: string, meta: RelationMetadata): void {
  let m = relationRegistry.get(ctor);
  if (!m) {
    m = new Map();
    relationRegistry.set(ctor, m);
  }
  m.set(name, meta);
}

// ── Convention registration (used by the auto-discovery loader) ───────────────

const _registeredModels = new WeakSet<Function>();
/**
 * class name → model class, for observer/policy association by name.
 * @internal
 */
export const modelsByName = new Map<string, Function>();

/**
 * Look up a model class by its (unqualified) class name.
 * @internal
 */
export function modelByName(name: string): Function | undefined {
  return modelsByName.get(name);
}

/** Index a model class under its name. Called by @table's drain and by registerModel(). */
function registerModelName(ctor: Function): void {
  const name = (ctor as { name?: string }).name;
  if (name) modelsByName.set(name, ctor);
}

/**
 * Register a model class discovered by convention — the loader calls this for every class
 * in `app/models/`, so `@table` is not required:
 *  - drains the class's buffered @column/@relation entries by matching a probe instance's
 *    own field names (Bun's deferred-decorator bug prevents binding name→class at definition
 *    without an anchor; the loader IS the anchor, and the probe reveals which buffered
 *    entries belong to this class — so convention models must use real fields, e.g.
 *    `@column() name!: string`, not `@column() declare name: string`);
 *  - indexes it under `modelsByName`.
 *
 * The convention table name is applied separately by the loader's models concern (which has
 * the inflector); explicit `@table("...")` / `static table` always wins. Idempotent and a
 * safe no-op on already-`@table`'d models.
 * @internal
 */
export function registerModel(ctor: Function): void {
  if (_registeredModels.has(ctor)) return;
  _registeredModels.add(ctor);

  if (_pending.length > 0) {
    let own = new Set<string>();
    try {
      own = new Set(Object.keys(new (ctor as new () => object)()));
    } catch {
      /* not constructible without args — can't claim columns by probe */
    }
    if (own.size) {
      // A class's field decorators run consecutively at definition, so its buffered
      // entries form a contiguous run; claim from the first own-matching entry until the
      // first entry that belongs to another class.
      const start = _pending.findIndex((e) => own.has(e.name));
      if (start !== -1) {
        let end = start;
        while (end < _pending.length && own.has(_pending[end]!.name)) end++;
        const claimed = _pending.splice(start, end - start);
        for (const e of claimed) e.apply(ctor);
      }
    }
  }

  registerModelName(ctor);
}

// ── Readers (prototype-chain merge; child wins) ───────────────────────────────

/**
 * Merged column definitions (own + inherited) for a class, or null if none.
 * @internal
 */
export function columnsFor(ctor: Function): Map<string, ColumnOptions> | null {
  const merged = new Map<string, ColumnOptions>();
  let cls: Function | null = ctor;
  while (cls && cls !== Function.prototype) {
    const c = columnRegistry.get(cls);
    if (c) for (const [k, v] of c) if (!merged.has(k)) merged.set(k, v);
    cls = Object.getPrototypeOf(cls) as Function | null;
  }
  return merged.size ? merged : null;
}

/**
 * Merged relation metadata (imperative mixins + @decorators, own + inherited).
 * @internal
 */
export function relationsFor(ctor: Function): Map<string, RelationMetadata> {
  const merged = new Map<string, RelationMetadata>();
  let cls: Function | null = ctor;
  while (cls && cls !== Function.prototype) {
    const r = relationRegistry.get(cls);
    if (r) for (const [k, v] of r) if (!merged.has(k)) merged.set(k, v);
    cls = Object.getPrototypeOf(cls) as Function | null;
  }
  return merged;
}

/**
 * Names of reactive (json/array cast) columns for a class (own + inherited).
 * @internal
 */
export function reactiveColumnsFor(ctor: Function): string[] {
  const cols = columnsFor(ctor);
  if (!cols) return [];
  const out: string[] = [];
  for (const [name, opts] of cols) {
    if (opts.cast === "json" || opts.cast === "array" || opts.type === "json") out.push(name);
  }
  return out;
}
