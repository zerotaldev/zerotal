import { makeRelationDecorator } from "./_registerRelation.ts";

/** Options for {@link hasOne}. */
export interface HasOneOptions {
  /** FK column on the related table pointing back to the parent (e.g. `user_id`). */
  foreignKey: string;
  /** Parent local key the FK references. Defaults to `'id'`. */
  localKey?: string | undefined;
}

/**
 * Declare a one-to-one relation: the parent owns a single related row, matched by
 * a foreign key on the related table (e.g. a `User` has one `Profile`).
 *
 * @param related - Lazy factory returning the related model class.
 * @param options - Foreign/local key configuration.
 * @category Relationships
 *
 * @example
 * ```ts
 * class User extends BaseModel {
 *   \@hasOne(() => Profile, { foreignKey: 'user_id' })
 *   profile!: HasOne<Profile>;
 * }
 * ```
 */
export function hasOne(related: () => unknown, options: HasOneOptions) {
  return makeRelationDecorator(() => ({
    type: "hasOne" as const,
    related,
    foreignKey: options.foreignKey,
    localKey: options.localKey ?? "id",
  }));
}
