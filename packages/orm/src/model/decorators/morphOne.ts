import { makeRelationDecorator } from "./_registerRelation.ts";

export interface MorphOneOptions {
  /**
   * The morph name — prefix for the `_type` and `_id` columns on the related table.
   * e.g. `morphName: 'imageable'` → columns `imageable_type`, `imageable_id`.
   */
  morphName: string;
  /** Override the local key. Defaults to 'id'. */
  localKey?: string | undefined;
}

/**
 * Declare the "one" side of a polymorphic one-to-one: the parent owns a single
 * related row that references it via `{morphName}_id` / `{morphName}_type`
 * columns (e.g. a `User` has one `Image` through an `imageable` morph).
 *
 * @param related - Lazy factory returning the related model class.
 * @param options - The morph name and optional local key.
 * @category Relationships
 *
 * @example
 * ```ts
 * class User extends BaseModel {
 *   \@morphOne(() => Image, { morphName: 'imageable' })
 *   avatar!: MorphOne<Image>;
 * }
 * ```
 */
export function morphOne(related: () => unknown, options: MorphOneOptions) {
  return makeRelationDecorator(() => ({
    type: "morphOne" as const,
    related,
    foreignKey: `${options.morphName}_id`,
    localKey: options.localKey ?? "id",
    morphTypeColumn: `${options.morphName}_type`,
  }));
}
