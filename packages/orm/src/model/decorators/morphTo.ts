import { makeRelationDecorator } from "./_registerRelation.ts";

export interface MorphToOptions {
  /** Maps the discriminator string stored in the _type column to the model factory. */
  morphMap: Record<string, () => unknown>;
  /**
   * Override the _type column name. Defaults to `<propertyName>_type`.
   * e.g. property `commentable` → `commentable_type`.
   */
  morphTypeColumn?: string | undefined;
  /**
   * Override the _id column name. Defaults to `<propertyName>_id`.
   * e.g. property `commentable` → `commentable_id`.
   */
  morphForeignKey?: string | undefined;
}

function _toSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Declare the inverse side of a polymorphic relation: this model belongs to one
 * of several possible parent types, resolved at load time from the `_type`
 * discriminator column via the {@link MorphToOptions.morphMap | morphMap}
 * (e.g. a `Comment` belongs to a `Post` or `Video` through `commentable`).
 *
 * @param options - The type-to-model map plus optional column-name overrides.
 * @category Relationships
 *
 * @example
 * ```ts
 * class Comment extends BaseModel {
 *   \@morphTo({ morphMap: { Post: () => Post, Video: () => Video } })
 *   commentable!: MorphTo<Post | Video>;
 * }
 * ```
 */
export function morphTo(options: MorphToOptions) {
  return makeRelationDecorator((_ctor, field) => {
    const snake = _toSnake(field);
    return {
      type: "morphTo" as const,
      related: () => ({}),
      foreignKey: options.morphForeignKey ?? `${snake}_id`,
      localKey: "id",
      morphMap: options.morphMap,
      morphTypeColumn: options.morphTypeColumn ?? `${snake}_type`,
    };
  });
}
