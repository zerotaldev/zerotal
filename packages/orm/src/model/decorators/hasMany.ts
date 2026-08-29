import { makeRelationDecorator } from "./_registerRelation.ts";

/** Options for {@link hasMany}. */
export interface HasManyOptions {
  /** FK column on the related table pointing back to the parent (e.g. `user_id`). */
  foreignKey: string;
  /** Parent local key the FK references. Defaults to `'id'`. */
  localKey?: string | undefined;
}

/**
 * Declare a one-to-many relation: the parent owns many related rows, matched by a
 * foreign key on the related table (e.g. a `User` has many `Post`s).
 *
 * @param related - Lazy factory returning the related model class.
 * @param options - Foreign/local key configuration.
 * @category Relationships
 *
 * @example
 * ```ts
 * class User extends BaseModel {
 *   \@hasMany(() => Post, { foreignKey: 'user_id' })
 *   posts!: HasMany<Post>;
 * }
 * ```
 */
export function hasMany(related: () => unknown, options: HasManyOptions) {
  return makeRelationDecorator(() => ({
    type: "hasMany" as const,
    related,
    foreignKey: options.foreignKey,
    localKey: options.localKey ?? "id",
  }));
}
