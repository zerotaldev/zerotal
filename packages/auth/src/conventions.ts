import type { ConcernDescriptor } from "@zerotal/core";
import { modelByName } from "@zerotal/orm";
import { Policy } from "./Policy.ts";
import type { GateService } from "./GateService.ts";
import { frameworkLog } from "@zerotal/core/logger";

function isPolicyClass(v: unknown): boolean {
  return (
    typeof v === "function" &&
    v !== Policy &&
    (v as { prototype?: unknown }).prototype instanceof Policy
  );
}

/**
 * Auto-discovery concern for `app/policies/`: each `XPolicy` is registered with the
 * Gate for model `X` (strip the `Policy` suffix and resolve via the model registry).
 * Override the target with `static model = SomeModel`. Installed by
 * {@link AuthProvider}; app code never invokes this directly.
 *
 * @internal
 */
export const policiesConcern: ConcernDescriptor = {
  name: "policies",
  order: 30,
  dir: "app/policies",
  register(mod, ctx) {
    const gate = ctx.resolve<GateService>("gate");
    if (!gate) return;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== "function") continue;
      const cls = exported as { name: string; model?: unknown };
      if (!isPolicyClass(exported) && cls.model === undefined && !/Policy$/.test(cls.name))
        continue;

      let model = cls.model as (new (...a: never[]) => unknown) | undefined;
      if (!model) {
        model = modelByName(cls.name.replace(/Policy$/, "")) as
          (new (...a: never[]) => unknown) | undefined;
      }
      if (!model) {
        frameworkLog("auth").warn(`Policy "${cls.name}": no matching model found; skipped`);
        continue;
      }
      gate.registerPolicy(model, exported as never);
    }
  },
};
