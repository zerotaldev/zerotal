import { makeRelationDecorator } from "./_registerRelation.ts";

export interface MorphManyOptions {
  /**
   * The morph name — prefix for the `_type` and `_id` columns on the related table.
   * e.g. `morphName: 'commentable'` → columns `commentable_type`, `commentable_id`.
   */
  morphName: string;
  /** Override the local key. Defaults to 'id'. */
  localKey?: string | undefined;
}

/**
 * Declare the "one" side of a polymorphic one-to-many: the parent owns many
 * related rows that reference it via `{morphName}_id` / `{morphName}_type`
 * columns (e.g. a `Post` has many `Comment`s through a `commentable` morph).
 *
 * @param related - Lazy factory returning the related model class.
 * @param options - The morph name and optional local key.
 * @category Relationships
 *
 * @example
 * ```ts
 * class Post extends BaseModel {
 *   \@morphMany(() => Comment, { morphName: 'commentable' })
 *   comments!: MorphMany<Comment>;
 * }
 * ```
 */
export function morphMany(related: () => unknown, options: MorphManyOptions) {
  return makeRelationDecorator(() => ({
    type: "morphMany" as const,
    related,
    foreignKey: `${options.morphName}_id`,
    localKey: options.localKey ?? "id",
    morphTypeColumn: `${options.morphName}_type`,
  }));
}
