// Synth (key "col") for arrays of ORM models: dehydrates a non-empty array of
// registered models to their ids (tagged with the model class name) and hydrates
// it back with a single `whereIn("id", ids)` query. Registered as a side effect
// of importing this module. Matches only when the array's first element is a
// registered model, so plain arrays fall through to the recursive serializer.
import type { BaseModel } from "@zerotal/orm";
import { registerSynth } from "./index.ts";
import { _modelRegistry, _modelClassToName } from "./ModelSynth.ts";

function isModelOf(value: unknown, ctor: typeof BaseModel): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as object).constructor === ctor &&
    typeof (value as Record<string, unknown>)["id"] !== "undefined"
  );
}

registerSynth({
  key: "col",

  match(value): value is BaseModel[] {
    if (!Array.isArray(value) || value.length === 0) return false;
    const first = value[0] as unknown;
    if (typeof first !== "object" || first === null) return false;
    // Key off the constructor, not constructor.name, so the match survives
    // minification (same hardening as ModelSynth).
    const ctor = (first as object).constructor as typeof BaseModel;
    if (!_modelClassToName.has(ctor)) return false;
    // Only claim a homogeneous array. A mixed array would be dehydrated under a
    // single class tag and silently lose the odd-one-out on hydrate, so let it
    // fall through to the recursive serializer, which handles each model via
    // ModelSynth.
    return value.every((m) => isModelOf(m, ctor));
  },

  dehydrate(value: BaseModel[], meta) {
    const ctor = (value[0] as object).constructor as typeof BaseModel;
    meta["class"] = _modelClassToName.get(ctor)!;
    return value.map((m) => (m as unknown as Record<string, unknown>)["id"]);
  },

  async hydrate(data, meta) {
    const cls = meta["class"] as string | undefined;
    if (!cls) throw new Error("[Flow] CollectionSynth: missing class in meta");
    const Model = _modelRegistry.get(cls);
    if (!Model) {
      throw new Error(
        `[Flow] Model "${cls}" is not registered. ` +
          `Add it to your Component's static models property.`,
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
