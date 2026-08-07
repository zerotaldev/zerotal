import type { BaseModel } from "@zerotal/orm";
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
 * Register an ORM model class under a stable name so the model synth can send it
 * across the wire: a model prop is dehydrated to its `id` (tagged with this name)
 * and hydrated back by re-fetching via `findOrFail`.
 *
 * @remarks
 * Registering by an explicit name (rather than `constructor.name`) keeps snapshots
 * valid under minification, where the class name may be mangled. You normally don't
 * call this directly — declare models in a component's `static models` map and the
 * framework registers them when the page is registered.
 *
 * @param name - Stable, developer-assigned name recorded in the snapshot's `meta.class`.
 * @param ModelClass - The `BaseModel` subclass to associate with `name`.
 *
 * @example
 * ```tsx
 * class ShowPost extends Component {
 *   static models = { Post }; // auto-calls registerFlowModel("Post", Post)
 *   @locked post!: Post;      // survives the round-trip as a rehydrated model
 * }
 *
 * // Or register manually (e.g. outside a page's static models):
 * registerFlowModel("Post", Post);
 * ```
 */
export function registerFlowModel(name: string, ModelClass: typeof BaseModel): void {
  _modelRegistry.set(name, ModelClass);
  _modelClassToName.set(ModelClass, name);
}

registerSynth({
  key: "mdl",

  match(value): value is BaseModel {
    // Lazy check: duck-type for BaseModel (avoids circular import of BaseModel class)
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as Record<string, unknown>)["id"] !== "undefined" &&
      typeof (value as Record<string, unknown>)["constructor"] === "function" &&
      _modelClassToName.has((value as object).constructor as typeof BaseModel)
    );
  },

  dehydrate(value: BaseModel, meta) {
    // Use the stable registered name rather than constructor.name, which is
    // mangled in minified production builds.
    meta["class"] = _modelClassToName.get((value as object).constructor as typeof BaseModel)!;
    return (value as unknown as Record<string, unknown>)["id"];
  },

  async hydrate(data, meta) {
    const cls = meta["class"] as string | undefined;
    if (!cls) throw new Error("[Flow] ModelSynth: missing class in meta");
    const Model = _modelRegistry.get(cls);
    if (!Model) {
      throw new Error(
        `[Flow] Model "${cls}" is not registered. ` +
          `Add it to your Component's static models property.`,
      );
    }
    // BaseModel.findOrFail is a static method
    return (Model as unknown as { findOrFail(id: unknown): Promise<BaseModel> }).findOrFail(data);
  },
});
