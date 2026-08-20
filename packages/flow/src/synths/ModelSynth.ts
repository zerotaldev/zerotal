import type { BaseModel } from "@zerotal/orm";
import { modelsByName } from "@zerotal/orm";
import { registerSynth } from "./index.ts";

// Models register themselves here when their class is imported.
// Populated via registerFlowModel() called in the Component's static `models` map.
export const _modelRegistry = new Map<string, typeof BaseModel>();

// Reverse map: class constructor → stable developer-assigned name.
// Using this instead of constructor.name prevents breakage under minification,
// where `Post` might be mangled to `n`. Exported so CollectionSynth shares the
// same minification-safe lookup.
export const _modelClassToName = new Map<typeof BaseModel, string>();

/**
 * Associate a model class with an explicit wire name, overriding its table name.
 *
 * @remarks
 * **Not part of the normal path.** Models live in `app/models` and are discovered there, and
 * a model travels under its table name — already declared, and immune to minification. There
 * is nothing to register.
 *
 * This exists for the framework's own wiring: a component's `static models` map routes
 * through it, and it takes precedence over the table name when both are present.
 *
 * @param name - The wire name recorded in the snapshot's `meta.class`.
 * @param ModelClass - The `BaseModel` subclass to associate with `name`.
 *
 * @internal
 */
export function registerFlowModel(name: string, ModelClass: typeof BaseModel): void {
  _modelRegistry.set(name, ModelClass);
  _modelClassToName.set(ModelClass, name);
}

/**
 * Is this value an ORM model?
 *
 * Duck-typed, because importing `BaseModel` as a value here would be circular. A model class
 * always carries a `table` string (set by `@table("…")` or inflected from the class name) and
 * every instance has `toJSON` — together specific enough to tell a model from a plain object.
 *
 * **This deliberately does not require registration.** It used to, and an unregistered model
 * fell through to the generic serializer, which walks properties directly and never calls
 * `toJSON()` — so `hidden` was bypassed and every column, password hashes included, was
 * written into the page. It failed on the second interaction and never the first, and
 * `FlowTest` does not round-trip through a synth, so only a browser ever saw it. A missing
 * declaration must not be able to cause that.
 *
 * @internal
 */
export function _isModel(value: unknown): value is BaseModel {
  if (typeof value !== "object" || value === null) return false;
  const ctor = (value as object).constructor as { table?: unknown } | undefined;
  if (typeof ctor !== "function") return false;
  if (typeof (ctor as { table?: unknown }).table !== "string") return false;
  return typeof Reflect.get(value, "toJSON") === "function";
}

/**
 * The stable key a model travels under.
 *
 * The table name, which the app already declares and a minifier cannot touch — unlike
 * `constructor.name`, which is exactly what `Post` becomes `n` in a production build. An
 * explicit {@link registerFlowModel} name still wins, for a model that wants one.
 *
 * @internal
 */
export function _modelKey(ctor: typeof BaseModel): string | undefined {
  const explicit = _modelClassToName.get(ctor);
  if (explicit) return explicit;
  const table: unknown = ctor.table;
  return typeof table === "string" && table.length > 0 ? table : undefined;
}

/**
 * Find the class a key names — an explicit registration first, then the ORM's own registry,
 * which `app/models` auto-discovery populates for every model in the app.
 *
 * @internal
 */
export function _resolveModel(key: string): typeof BaseModel | undefined {
  const explicit = _modelRegistry.get(key);
  if (explicit) return explicit;

  for (const ctor of modelsByName.values()) {
    if (Reflect.get(ctor, "table") === key) return ctor as typeof BaseModel;
  }
  return undefined;
}

const _wireFieldCache = new WeakMap<typeof BaseModel, readonly string[]>();

/**
 * Convert a model's `toJSON()` output so any nested model in it is its own `toJSON()` too.
 *
 * `BaseModel.toJSON()` assigns relations by reference — `out[key] = this[key]` — so a loaded
 * `post.author` comes out as a live `User`. In practice its `hidden` list still applied,
 * because whatever stringified the snapshot honoured the `toJSON` contract. That is an
 * implicit guarantee sitting under a security property, and it holds only for as long as
 * every path to the wire goes through `JSON.stringify`.
 *
 * Doing it here makes it explicit: what leaves this synth is data, and every model in it has
 * already answered for its own hidden columns.
 *
 * @internal
 */
export function _deepToJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return undefined; // a relation cycle (post.author.posts)
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => _deepToJson(v, seen));

  if (_isModel(value)) {
    const json = Reflect.get(value, "toJSON") as () => Record<string, unknown>;
    return _deepToJson(json.call(value), seen);
  }

  // A Date, a Carbon, anything with its own serialisation — leave it to the value's own
  // contract rather than walking into its internals.
  if (typeof Reflect.get(value, "toJSON") === "function") return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = _deepToJson(v, seen);
  }
  return out;
}

/**
 * The fields a client may **write back**: `fillable`.
 *
 * `hidden` is not subtracted, because the two allow-lists answer different questions.
 * `fillable`/`guarded` govern writes; `visible`/`hidden` govern display. A password is the
 * case that makes the difference concrete: it is fillable because a user sets it, and hidden
 * because the stored hash must never be shown. Subtracting made it unwritable too, which
 * meant a bound password field silently did nothing.
 *
 * What keeps that safe is that a hidden field is never *sent* — see the synth's `dehydrate`
 * and {@link _pendingSecrets}.
 *
 * `fillable` on its own is the wrong set. It is the mass-assignment allow-list — what a user
 * may *write* — and that is not the same as what may be *shown*. The ORM's own example is the
 * counter-example:
 *
 * ```ts
 * static fillable = ["name", "email", "password"];
 * static hidden   = ["password"];
 * ```
 *
 * A password is fillable and must never reach a browser. The subtraction lives here rather
 * than in each model because the failure is silent: nothing goes wrong until someone reads
 * the snapshot in dev tools.
 *
 * A model that declares no `fillable` accepts **no writes at all** — which is the ORM's own
 * default, since it guards mass assignment until told otherwise. Such a model is still fully
 * readable on the client; it simply cannot be edited there.
 *
 * @internal
 */
export function _writableFields(ModelClass: typeof BaseModel): readonly string[] {
  const cached = _wireFieldCache.get(ModelClass);
  if (cached) return cached;

  const fields = Object.freeze([...(ModelClass.fillable ?? [])]);

  _wireFieldCache.set(ModelClass, fields);
  return fields;
}

/**
 * Whether a value is an instance of a model registered with {@link registerFlowModel}.
 *
 * The same duck-typed check the synth's `match` uses, exported so `$set` can recognise a
 * hydrated model without importing `BaseModel` (which would be circular).
 *
 * @internal
 */
export function _isRegisteredModel(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["constructor"] === "function" &&
    _modelClassToName.has((value as object).constructor as typeof BaseModel)
  );
}

/**
 * Hidden fields whose current value came from the client, per model instance.
 *
 * A hidden column is never sent — that is the point of `hidden`, and the stored password hash
 * has no business in a page. But a hidden column can still be *written*: a user typing a new
 * password needs that value to survive until they save, and dropping it would mean the field
 * silently emptied itself on the next interaction.
 *
 * The distinction that makes this safe is **who produced the value**. Echoing back something
 * the client just typed tells it nothing it does not already have. Echoing a value the server
 * computed — a generated token, a rotated secret — would be a disclosure, which is why this
 * tracks what {@link _applyWireValues} actually applied rather than asking `$dirty()`, which
 * cannot tell the two apart.
 *
 * @internal
 */
const _pendingSecrets = new WeakMap<object, Set<string>>();

/** The hidden fields on `model` currently holding a client-supplied value. @internal */
export function _pendingSecretKeys(model: object): readonly string[] {
  return [...(_pendingSecrets.get(model) ?? [])];
}

/** Mark hidden fields as client-supplied, so they survive the next round-trip. @internal */
export function _markPendingSecrets(model: object, keys: readonly string[]): void {
  if (keys.length === 0) return;
  const set = _pendingSecrets.get(model) ?? new Set<string>();
  for (const k of keys) set.add(k);
  _pendingSecrets.set(model, set);
}

/**
 * Restore a model to the state it was in when we last dehydrated it.
 *
 * The values come from the snapshot, which is HMAC-signed over `data` and `memo` — so they
 * are the server's own last output, not anything a browser could author. A change an action
 * made and did not save is part of that state, and restoring it is what stops the field
 * reverting the moment anything else happens.
 *
 * **Only the writable fields.** Everything else — `role`, `createdAt`, anything the server
 * owns — comes from the row that was just fetched, which is current by definition. Carrying
 * those forward from a snapshot would replace fresh values with older ones for no gain,
 * since nothing in the round-trip could have changed them. The editable subset is the only
 * part that holds state worth preserving.
 *
 * (Hidden columns never appear here anyway: `toJSON()` leaves them out, so there is nothing
 * to restore. The set is the same one {@link _applyWireValues} enforces.)
 *
 * Only properties the instance already carries are set, so an `appends` entry or a computed
 * accessor in `toJSON()` output cannot be written over the real one. `id` is skipped — the
 * identity is `meta.id` and the row was fetched by it.
 *
 * @internal
 */
export function _restoreSnapshotValues(model: object, data: unknown): void {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return;

  const writable = new Set(_writableFields(model.constructor as typeof BaseModel));

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key === "id" || key.startsWith("_")) continue;
    if (!writable.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(model, key)) continue;
    Reflect.set(model, key, value);
  }
}

/**
 * Apply client-supplied values to a model, keeping only its wire fields.
 *
 * Filters rather than letting `fill()` reject: `fill()` throws `MassAssignmentError` off
 * `fillable`, and this data comes from the browser, so a hostile payload would become a 500
 * instead of being ignored. Everything that survives the filter is fillable by construction,
 * so `fill()` runs its normal path — reactive accessors, casts and all.
 *
 * @internal
 */
export function _applyWireValues(model: object, data: unknown): void {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return;

  const allowed = new Set(_writableFields(model.constructor as typeof BaseModel));
  const incoming: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (allowed.has(key)) incoming[key] = value;
  }

  if (Object.keys(incoming).length === 0) return;

  // `fill` is typed `UpdatePayload<this>`, which cannot be expressed for a model this
  // function only knows as `BaseModel`. The values are already filtered to the class's own
  // `fillable`, so the assertion is narrower than it looks.
  (model as unknown as { fill(v: Record<string, unknown>): unknown }).fill(incoming);

  // A hidden field the client just set has to travel back, or it empties itself on the next
  // interaction. Recorded here, where we know the value came from the browser.
  const hidden = new Set((model.constructor as typeof BaseModel).hidden ?? []);
  _markPendingSecrets(
    model,
    Object.keys(incoming).filter((k) => hidden.has(k)),
  );
}

registerSynth({
  key: "mdl",

  match: _isModel,

  dehydrate(value: BaseModel, meta) {
    // Use the stable registered name rather than constructor.name, which is
    // mangled in minified production builds.
    const ctor = (value as object).constructor as typeof BaseModel;
    const key = _modelKey(ctor);
    if (!key) {
      throw new Error(
        `[Flow] ${ctor.name} has no table name, so it cannot be sent across the wire. ` +
          `Give it @table("…") — every model in app/models has one.`,
      );
    }
    meta["class"] = key;

    // The id goes in `meta`, never in `data`. `$set` replaces a prop's data and never
    // touches its meta, so keeping the key out of the editable payload is what makes
    // "the client cannot change which record this is" true rather than merely intended.
    meta["id"] = Reflect.get(value, "id");

    // What the client is *shown* is the model's own serialisation surface — `toJSON()`, which
    // already honours `visible` / `hidden` / `appends` and any per-instance overrides. Using
    // the writable set here instead would have made `@locked` pointless: a display model
    // declares no `fillable`, so it would have arrived as a bare id, and a prop that puts
    // nothing on the client is what `@transient` is for.
    const toJson = Reflect.get(value, "toJSON");
    const out: Record<string, unknown> =
      typeof toJson === "function"
        ? (_deepToJson(toJson.call(value)) as Record<string, unknown>)
        : { id: Reflect.get(value, "id") };

    // Hidden fields the client itself supplied ride along, and say so in `meta` so the next
    // hydrate keeps treating them as pending rather than as a read of the row. Nothing the
    // *server* put there is echoed — only what came back through `updates`.
    const pending = _pendingSecretKeys(value);
    if (pending.length > 0) {
      for (const key of pending) out[key] = Reflect.get(value, key);
      meta["p"] = pending;
    }

    return out;
  },

  async hydrate(data, meta) {
    const cls = meta["class"] as string | undefined;
    if (!cls) throw new Error("[Flow] ModelSynth: missing class in meta");
    const Model = _resolveModel(cls);
    if (!Model) {
      throw new Error(
        `[Flow] No model maps to "${cls}". Models live in app/models, where they are ` +
          `discovered automatically — check the class is there and its @table matches.`,
      );
    }

    // `meta.id` is the identity; `data` is only ever field values. A snapshot written before
    // wire fields existed carried the id as `data`, so fall back to it — those stay valid
    // for their remaining lifetime rather than throwing.
    const id = meta["id"] !== undefined ? meta["id"] : data;

    // Fetch first, overlay second. The fresh row supplies everything the client did not
    // touch; the client's values win where it typed. `_original` is therefore the row as it
    // is *now*, so `$dirty()` — and the UPDATE `save()` builds from it — covers exactly the
    // fields that genuinely differ from the database.
    const model = await (
      Model as unknown as { findOrFail(id: unknown): Promise<BaseModel> }
    ).findOrFail(id);

    // Fetch for identity — a live instance, its relations, and a 404 if the row is gone —
    // then restore the state we last had. The snapshot is signed, so those values are ours,
    // not the client's; an unsaved change an action made is part of the component's state and
    // has to survive the round-trip or the field would revert the moment anything else
    // happened.
    //
    // Client *intent* arrives separately, in the frame's `updates` map, and is applied after
    // this through `_applyClientUpdate` — where `fillable` is enforced.
    _restoreSnapshotValues(model, data);

    // Keep the marks across the round-trip, so a pending password survives more than one
    // interaction rather than only the next.
    const pending = meta["p"];
    if (Array.isArray(pending)) _markPendingSecrets(model, pending as string[]);

    return model;
  },
});
