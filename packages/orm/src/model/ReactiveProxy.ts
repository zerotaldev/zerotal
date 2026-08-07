import type { BaseModel } from "./BaseModel.ts";

type ProxyTarget = Record<string | symbol, unknown>;

const _proxyCache = new WeakMap<object, object>();

/**
 * Wrap an object/array `target` in a deeply-reactive `Proxy` so that any nested
 * mutation marks `model`'s `propertyKey` dirty (via {@link BaseModel.markDirty}),
 * ensuring in-place edits of `json`/`array` cast columns are persisted on the
 * next `save()`.
 *
 * Non-object values, `null`, and `Date` instances are returned unwrapped.
 * Nested objects are proxied lazily on access, and proxies are cached per target
 * (WeakMap) so repeated wrapping is cheap and identity-stable. Used by the
 * ORM when a model has {@link BaseModel.reactiveCasts} enabled.
 *
 * @param model The owning model instance to flag dirty on mutation.
 * @param propertyKey The column property the target belongs to.
 * @param target The value to make reactive.
 * @returns A reactive proxy of `target`, or `target` unchanged if not proxyable.
 */
export function makeReactive<T>(model: BaseModel, propertyKey: string, target: T): T {
  if (typeof target !== "object" || target === null || target instanceof Date) {
    return target;
  }

  const cached = _proxyCache.get(target as object) as T | undefined;
  if (cached) return cached;

  const proxy = new Proxy(target as ProxyTarget, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value === "object" && value !== null && !(value instanceof Date)) {
        return makeReactive(model, propertyKey, value);
      }
      return value;
    },
    set(obj, prop, value, receiver) {
      const result = Reflect.set(obj, prop, value, receiver);
      model.markDirty(propertyKey as keyof BaseModel);
      return result;
    },
    deleteProperty(obj, prop) {
      const result = Reflect.deleteProperty(obj, prop);
      model.markDirty(propertyKey as keyof BaseModel);
      return result;
    },
  });

  _proxyCache.set(target as object, proxy);
  return proxy as unknown as T;
}
