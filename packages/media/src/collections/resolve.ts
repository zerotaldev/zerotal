import { UnknownCollectionError } from "../errors.ts";
import type { CollectionDefinition, MediaCollections } from "../types.ts";

/** A model class that may declare media collections. */
/** @internal — the structural shape `resolveCollection` reads off a model. */
export interface CollectionHost {
  name: string;
  mediaCollections?: MediaCollections;
}

/**
 * The collection definition a model declares under `name`.
 *
 * Values may be a plain object or a thunk; the thunk is called on every lookup
 * rather than cached, because the reason to write one is a value that changes
 * between calls (the current tenant's disk, say).
 *
 * @throws {UnknownCollectionError} when the model declares no such collection —
 *   listing the ones it does declare, because the mistake is nearly always a typo.
 *
 * @internal — collection lookup; apps declare `mediaCollections` and never call this.
 */
export function resolveCollection(host: CollectionHost, name: string): CollectionDefinition {
  const declared = host.mediaCollections ?? {};
  const entry = declared[name];

  if (entry === undefined) {
    throw new UnknownCollectionError(host.name, name, Object.keys(declared));
  }

  return typeof entry === "function" ? entry() : entry;
}

/** Whether a model declares a collection under `name`. */
/** @internal — collection lookup; apps declare `mediaCollections` and never call this. */
export function hasCollection(host: CollectionHost, name: string): boolean {
  return (host.mediaCollections ?? {})[name] !== undefined;
}

/** Every collection name the model declares. */
/** @internal — collection lookup; apps declare `mediaCollections` and never call this. */
export function collectionNames(host: CollectionHost): string[] {
  return Object.keys(host.mediaCollections ?? {});
}
