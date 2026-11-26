import { currentApp } from "@zerotal/core";
import type { ContainerBindings } from "@zerotal/core";

/**
 * A service another package binds, resolved by name and typed by the slice of it
 * the caller uses — or `undefined` when that package is not registered.
 *
 * This is how settings reaches `@zerotal/audit` and `@zerotal/admin` without
 * depending on either: an app without them pulls in nothing, the binding is
 * simply absent. The key is not in this package's `ContainerBindings`, since the
 * package that binds it declares it there.
 *
 * @internal
 */
export function _optionalService<T>(name: string): T | undefined {
  const key = name as keyof ContainerBindings;
  try {
    const container = currentApp().container;
    if (!container.bound(key)) return undefined;
    return container.makeSync<T>(key);
  } catch {
    return undefined;
  }
}
