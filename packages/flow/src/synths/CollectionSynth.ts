// Synth (key "col") for arrays of ORM models: dehydrates a non-empty array of
// registered models to their ids (tagged with the model class name) and hydrates
// it back with a single `whereIn("id", ids)` query. Registered as a side effect
// of importing this module. Matches only when the array's first element is a
// registered model, so plain arrays fall through to the recursive serializer.
import type { BaseModel } from "@zerotal/orm";
import { registerSynth } from "./index.ts";
import { _isModel, _modelKey, _resolveModel } from "./ModelSynth.ts";

function isModelOf(value: unknown, ctor: typeof BaseModel): boolean {
  return _isModel(value) && (value as object).constructor === ctor;
}

registerSynth({
  key: "col",

  match(value): value is BaseModel[] {
    if (!Array.isArray(value) || value.length === 0) return false;
    const first = value[0] as unknown;
    // Registration is not required: an unregistered model would fall through to the generic
    // serializer, which never calls `toJSON()` and so publishes every column. Same reasoning
    // as ModelSynth's `match`.
    if (!_isModel(first)) return false;
    const ctor = (first as object).constructor as typeof BaseModel;
    // Only claim a homogeneous array. A mixed array would be dehydrated under a
    // single class tag and silently lose the odd-one-out on hydrate, so let it
    // fall through to the recursive serializer, which handles each model via
    // ModelSynth.
    return value.every((m) => isModelOf(m, ctor));
  },

  dehydrate(value: BaseModel[], meta) {
    const ctor = (value[0] as object).constructor as typeof BaseModel;
    const key = _modelKey(ctor);
    if (!key) {
      throw new Error(
        `[Flow] ${ctor.name} has no table name, so it cannot be sent across the wire. ` +
          `Give it @table("…") — every model in app/models has one.`,
      );
    }
    meta["class"] = key;
    return value.map((m) => (m as unknown as Record<string, unknown>)["id"]);
  },

  async hydrate(data, meta) {
    const cls = meta["class"] as string | undefined;
    if (!cls) throw new Error("[Flow] CollectionSynth: missing class in meta");
    const Model = _resolveModel(cls);
    if (!Model) {
      throw new Error(
        `[Flow] No model maps to "${cls}". Models live in app/models, where they are ` +
          `discovered automatically — check the class is there and its @table matches.`,
      );
    }
    const ids = data as unknown[];
    return (
      Model as unknown as {
        whereIn(col: string, vals: unknown[]): { get(): Promise<BaseModel[]> };
      }
    )
      .whereIn("id", ids)
      .get();
  },
});
