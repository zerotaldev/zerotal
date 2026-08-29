import { makeRelationDecorator } from "./_registerRelation.ts";

/** Options for {@link belongsTo}. */
export interface BelongsToOptions {
  /** FK column on this (child) model pointing to the related row (e.g. `user_id`). */
  foreignKey: string;
  /** Key on the related model the FK references. Defaults to `'id'`. */
  localKey?: string | undefined;
  /** Return a default (unsaved) related model instead of null when absent. */
  withDefault?: boolean | Record<string, unknown> | ((model: unknown) => void) | undefined;
}

/**
 * Declare the inverse of a one-to-many / one-to-one: this model belongs to a
 * single related row referenced by a foreign key on this model's table (e.g. a
 * `Post` belongs to a `User`).
 *
 * @param related - Lazy factory returning the related model class.
 * @param options - Foreign/local key configuration, plus optional `withDefault`.
 * @category Relationships
 *
 * @example
 * ```ts
 * class Post extends BaseModel {
 *   \@belongsTo(() => User, { foreignKey: 'user_id' })
 *   author!: BelongsTo<User>;
 * }
 * ```
 */
export function belongsTo(related: () => unknown, options: BelongsToOptions) {
  return makeRelationDecorator(() => ({
    type: "belongsTo" as const,
    related,
    foreignKey: options.foreignKey,
    localKey: options.localKey ?? "id",
    ...(options.withDefault !== undefined ? { withDefault: options.withDefault } : {}),
  }));
}
