// ── SoftDeletes mixin ─────────────────────────────────────────────────────────
//
// Opt-in soft deletes. Compose it so only models that want them carry the API —
// `deletedAt`, `forceDelete()`, `restore()`, `trashed()`, and the `withTrashed()` /
// `onlyTrashed()` query scopes. A hard-delete model has none of these.
//
//   import { BaseModelWith, SoftDeletes } from "@zerotal/orm";
//
//   @table("posts")
//   class Post extends BaseModelWith(SoftDeletes) {
//     @column() title!: string;
//   }
//
//   await post.delete();        // sets deleted_at; row hidden from default queries
//   await Post.withTrashed().get();
//   await post.restore();       // deleted_at = NULL
//   await post.forceDelete();   // permanent
//
// Setting `static softDeletes = true` is what the query engine and schema sync read
// (every query scopes `WHERE deleted_at IS NULL`, and the migrator provisions the
// `deleted_at` column) — the mixin flips it for you.

import { _resolveConn, type BaseModel } from "./BaseModel.ts";
import { ModelQueryBuilder } from "./ModelQueryBuilder.ts";
import { QueryBuilder } from "../db/QueryBuilder.ts";
import type { Constructor } from "./mixins.ts";

// Structural view of the concrete model class used by the static scopes.
interface SoftDeleteModelClass<T extends BaseModel> {
  table: string;
  primaryKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): T;
}

/**
 * Mixin that adds opt-in soft deletes to a model. Compose it so only models that
 * want them carry the API — `deletedAt`, {@link SoftDeletes.forceDelete},
 * {@link SoftDeletes.restore}, {@link SoftDeletes.trashed}, and the
 * {@link SoftDeletes.withTrashed} / {@link SoftDeletes.onlyTrashed} query scopes.
 *
 * The mixin flips `static softDeletes = true`, which is what the query engine and
 * schema sync read: every default query scopes `WHERE deleted_at IS NULL`, the
 * migrator provisions a `deleted_at` column, and `delete()` sets `deleted_at`
 * instead of removing the row.
 *
 * @example
 * ```ts
 * @table("posts")
 * class Post extends BaseModelWith(SoftDeletes) {
 *   @column() title!: string;
 * }
 *
 * await post.delete();               // sets deleted_at; hidden from default queries
 * await Post.withTrashed().get();     // includes soft-deleted rows
 * await Post.onlyTrashed().get();     // only soft-deleted rows
 * await post.restore();               // deleted_at = NULL
 * await post.forceDelete();           // permanent DELETE
 * ```
 */
export function SoftDeletes<TBase extends Constructor>(Base: TBase) {
  class SoftDeletes extends Base {
    /** Engine switch — query scoping + schema `deleted_at` provisioning read this. */
    static softDeletes = true;

    /** When the row was soft-deleted, or null/undefined when live. */
    declare deletedAt?: Date | null;

    /** A query that INCLUDES soft-deleted rows (bypasses the default scope). */
    static withTrashed<T extends BaseModel>(this: SoftDeleteModelClass<T>): ModelQueryBuilder<T> {
      return new ModelQueryBuilder<T>(this.table, _resolveConn(this as never), this as never);
    }

    /** A query that returns ONLY soft-deleted rows. */
    static onlyTrashed<T extends BaseModel>(this: SoftDeleteModelClass<T>): ModelQueryBuilder<T> {
      const qb = new ModelQueryBuilder<T>(this.table, _resolveConn(this as never), this as never);
      qb.whereNotNull("deleted_at");
      return qb;
    }

    /** True when this record is currently soft-deleted. */
    trashed(): boolean {
      return (this as { deletedAt?: unknown }).deletedAt != null;
    }

    /** Permanently delete the row, bypassing soft delete. */
    async forceDelete(): Promise<void> {
      const M = this.constructor as unknown as { table: string; primaryKey: string };
      await new QueryBuilder(M.table, _resolveConn(this.constructor as never))
        .where(M.primaryKey, (this as { id?: unknown }).id)
        .delete();
    }

    /**
     * Restore a soft-deleted record by setting `deleted_at` back to NULL, so it
     * reappears in normal queries.
     */
    async restore(): Promise<void> {
      const M = this.constructor as unknown as { table: string; primaryKey: string };
      await new QueryBuilder(M.table, _resolveConn(this.constructor as never))
        .where(M.primaryKey, (this as { id?: unknown }).id)
        .update({ deleted_at: null });
      (this as { deletedAt?: unknown }).deletedAt = null;
    }
  }

  return SoftDeletes;
}
