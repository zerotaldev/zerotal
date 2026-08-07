import { setImplicitModelResolver, Str, singularize } from "@zerotal/core";
import type { ModelBindingResolver, HttpContext } from "@zerotal/core";
import { modelsByName } from "./model/decorators/_metadata.ts";

interface ImplicitModel {
  name: string;
  implicitBinding?: boolean;
  implicitBindingKey?: string;
  findOrFail(id: number | string): Promise<unknown>;
  resolveRouteBinding?(value: string, ctx: HttpContext, param: string): Promise<unknown>;
}

/**
 * Find the registered model that should resolve a given route param, or undefined.
 *
 * Resolution order:
 *   1. A model whose `static implicitBindingKey` equals the param name.
 *   2. Class-name convention: `:user` -> `User`, `:blogPost` -> `BlogPost`, `:users` -> `User`.
 * Models with `static implicitBinding = false` are skipped.
 *
 * @param paramName - The route parameter name (without the leading colon).
 * @returns The matching model class, or `undefined` if none resolves.
 * @internal
 */
export function modelForParam(paramName: string): ImplicitModel | undefined {
  // 1. Explicit implicitBindingKey wins.
  for (const ctor of modelsByName.values()) {
    const M = ctor as unknown as ImplicitModel;
    if (M.implicitBinding === false) continue;
    if (M.implicitBindingKey && M.implicitBindingKey === paramName) return M;
  }
  // 2. Class-name convention.
  // A model that set an explicit implicitBindingKey claims only that key (handled above),
  // so it no longer answers to its class name here.
  for (const candidate of [Str.pascalCase(paramName), Str.pascalCase(singularize(paramName))]) {
    const ctor = modelsByName.get(candidate);
    if (!ctor) continue;
    const M = ctor as unknown as ImplicitModel;
    if (M.implicitBinding === false) continue;
    if (M.implicitBindingKey) continue;
    return M;
  }
  return undefined;
}

/**
 * Install the implicit route-model-binding resolver into the core Router. Called by
 * `DatabaseProvider.onRegister()`. The resolver reads the model registry lazily (at route
 * compile time), so it works no matter when models register during boot.
 * @internal
 */
/**
 * Build the binding resolver for a route param, or undefined when no model claims it.
 *
 * A model may own its lookup by declaring `static resolveRouteBinding` — resolving by a slug
 * or username, scoping to the tenant, eager-loading a relation. It receives the param name,
 * so one model can answer differently for `:user` and `:username` without matching on the
 * URL. Without it, the default is a primary-key `findOrFail`.
 *
 * @internal
 */
export function resolverForParam(paramName: string): ModelBindingResolver | undefined {
  const M = modelForParam(paramName);
  if (!M) return undefined;
  return (value, ctx) =>
    typeof M.resolveRouteBinding === "function"
      ? M.resolveRouteBinding(value, ctx, paramName)
      : M.findOrFail(value);
}

export function registerImplicitBinding(): void {
  setImplicitModelResolver(resolverForParam);
}
