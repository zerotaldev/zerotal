import { makeRelationDecorator } from "./_registerRelation.ts";
import type { HasManyThroughOptions } from "./hasManyThrough.ts";

/**
 * Declare a has-one-through relation: reach a single related record across one
 * intermediate ("through") model (the one-to-one counterpart of
 * {@link hasManyThrough}).
 *
 * @remarks Not supported by {@link has} / {@link whereHas}; use eager
 * {@link ModelQueryBuilder.with | with()} to load it.
 *
 * @param related - Lazy factory returning the far/related model class.
 * @param through - Lazy factory returning the intermediate model class.
 * @param options - First/second key configuration across the two hops.
 * @category Relationships
 *
 * @example
 * ```ts
 * class Country extends BaseModel {
 *   \@hasOneThrough(() => Post, () => User, { firstKey: 'country_id', secondKey: 'user_id' })
 *   latestPost!: HasOne<Post>;
 * }
 * ```
 */
export function hasOneThrough(
  related: () => unknown,
  through: () => unknown,
  options: HasManyThroughOptions,
) {
  return makeRelationDecorator(() => ({
    type: "hasOneThrough" as const,
    related,
    through,
    firstKey: options.firstKey,
    secondKey: options.secondKey,
    foreignKey: options.secondKey,
    localKey: options.localKey ?? "id",
    throughLocalKey: options.throughLocalKey ?? "id",
  }));
}
