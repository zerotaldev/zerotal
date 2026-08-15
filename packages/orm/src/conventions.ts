import type { ConcernDescriptor } from "@zerotal/core";
import { tableNameFor } from "@zerotal/core";
import { BaseModel } from "./model/BaseModel.ts";
import { registerModel, modelByName } from "./model/decorators/_metadata.ts";
import { frameworkLog } from "@zerotal/core/logger";
import type { ClassRef } from "./support/classRef.ts";

function isModelClass(v: unknown): boolean {
  return (
    typeof v === "function" &&
    v !== BaseModel &&
    (v as { prototype?: unknown }).prototype instanceof BaseModel
  );
}

/**
 * `app/models/` — every `BaseModel` subclass is registered: columns drained, table name
 * derived by convention (unless `@table`/`static table` set one), indexed by class name.
 * Runs first (order 10) so observers/policies can resolve their target model by name.
 * @internal
 */
export const modelsConcern: ConcernDescriptor = {
  name: "models",
  order: 10,
  dir: "app/models",
  register(mod) {
    for (const exported of Object.values(mod)) {
      if (!isModelClass(exported)) continue;
      const Model = exported as unknown as { name: string; table?: string };
      registerModel(Model as unknown as ClassRef);
      // Convention table name — explicit @table / static table always wins.
      if (!Model.table) Model.table = tableNameFor(Model.name);
    }
  },
};

/**
 * `app/observers/` — `XObserver` is attached to model `X` (strip the `Observer` suffix and
 * look it up in the model registry). Override with `static model = SomeModel`.
 * @internal
 */
export const observersConcern: ConcernDescriptor = {
  name: "observers",
  order: 20,
  dir: "app/observers",
  register(mod) {
    for (const exported of Object.values(mod)) {
      if (typeof exported !== "function") continue;
      const cls = exported as { name: string; model?: unknown };
      if (cls.model === undefined && !/Observer$/.test(cls.name)) continue;

      let model = cls.model as typeof BaseModel | undefined;
      if (!model)
        model = modelByName(cls.name.replace(/Observer$/, "")) as typeof BaseModel | undefined;
      if (!model) {
        frameworkLog("orm").warn(`Observer "${cls.name}": no matching model found; skipped`);
        continue;
      }
      model.observe(exported as never);
    }
  },
};

/**
 * The ORM's convention concerns, registered by {@link DatabaseProvider} in order.
 * @internal
 */
export const ormConcerns: ConcernDescriptor[] = [modelsConcern, observersConcern];
