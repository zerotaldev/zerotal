import { modelsByName } from "@zerotal/orm";
import { AuthUser } from "./AuthUser.ts";
import { isAuthenticatable } from "./Authenticatable.ts";

/**
 * The registered authenticatable model — i.e. the app's user model. Resolved lazily from the
 * model registry (populated by convention discovery / `@table`), so no `resolveUsing(...)` wiring
 * is needed. Detects the `Authenticatable` brand, so it works whether the model uses
 * `extends AuthUser` or `extends Model.using(Authenticatable, …)`. Prefers a model literally
 * named `User` when several match; falls back to the first. Returns `undefined` if the app has no
 * authenticatable model registered.
 */
export function authUserModel(): typeof AuthUser | undefined {
  let first: typeof AuthUser | undefined;
  for (const model of modelsByName.values()) {
    if (model === AuthUser) continue;
    if (isAuthenticatable(model)) {
      if ((model as { name?: string }).name === "User") return model as typeof AuthUser;
      first ??= model as typeof AuthUser;
    }
  }
  return first;
}

/**
 * Default `auth.userLoader` — finds the registered `AuthUser` model and loads by id. Used when the
 * app hasn't provided an explicit resolver via `AuthProvider.resolveUsing(...)` /
 * `app.withUserResolver(...)`.
 */
export async function defaultUserLoader(id: number): Promise<AuthUser | null> {
  const Model = authUserModel() as { find?(id: number): Promise<AuthUser | null> } | undefined;
  if (!Model?.find) return null;
  return Model.find(id);
}
