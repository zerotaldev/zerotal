import { makeRelationDecorator } from "./_registerRelation.ts";

export interface HasManyThroughOptions {
  /** FK on the through table referencing the parent (e.g. 'country_id' on users). */
  firstKey: string;
  /** FK on the related table referencing the through model (e.g. 'user_id' on posts). */
  secondKey: string;
  /** Parent local key the firstKey references. Default 'id'. */
  localKey?: string | undefined;
  /** Through local key the secondKey references. Default 'id'. */
  throughLocalKey?: string | undefined;
}

/**
 * Declare a has-many-through relation: reach the related rows across one
 * intermediate ("through") model — e.g. `Country` —(users.country_id)→ `User`
 * —(posts.user_id)→ `Post`, so a country has many posts through its users.
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
 *   \@hasManyThrough(() => Post, () => User, { firstKey: 'country_id', secondKey: 'user_id' })
 *   posts!: HasMany<Post>;
 * }
 * ```
 */
export function hasManyThrough(
  related: () => unknown,
  through: () => unknown,
  options: HasManyThroughOptions,
) {
  return makeRelationDecorator(() => ({
    type: "hasManyThrough" as const,
    related,
    through,
    firstKey: options.firstKey,
    secondKey: options.secondKey,
    foreignKey: options.secondKey,
    localKey: options.localKey ?? "id",
    throughLocalKey: options.throughLocalKey ?? "id",
  }));
}
