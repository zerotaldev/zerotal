import type { SQLInstance } from "./sql-types.ts";

/**
 * Decouples the ORM from the DI container: a function that returns the active
 * base connection (or `undefined` if none is registered yet).
 */
type ConnectionResolver = () => SQLInstance | undefined;

let _resolver: ConnectionResolver | null = null;

/**
 * Register the callback used to look up the base connection from the container.
 * Pass `null` to clear it. Set once by the `DatabaseProvider` at boot.
 */
export function setConnectionResolver(fn: ConnectionResolver | null): void {
  _resolver = fn;
}

/**
 * Resolve the container's base connection via the registered resolver, swallowing
 * any resolver error. Returns `undefined` when no resolver is set or it fails.
 */
export function resolveContainerConnection(): SQLInstance | undefined {
  if (!_resolver) return undefined;
  try {
    return _resolver();
  } catch {
    return undefined;
  }
}
