import { drainPendingMembers } from "./_metadata.ts";
import type { ClassRef } from "../../support/classRef.ts";

/**
 * Options object accepted as the second argument to `@table()`.
 * Equivalent to calling the fluent chain methods — choose whichever style you prefer.
 *
 * @example
 * @table("users", { timestamps: true })
 * export class User extends BaseModel { ... }
 */
export interface TableOptions {
  /** Enable / disable automatic timestamp columns. @default true */
  timestamps?: boolean;
  /** Override the primary key column name. @default "id" */
  primaryKey?: string;
}

/**
 * Configuration collected by the fluent builder.
 * @internal
 */
interface TableConfig {
  tableName: string;
  timestamps: boolean;
  primaryKey: string;
}

/**
 * A function that acts as a class decorator AND exposes chainable configuration
 * methods. Every chain method returns the same builder so you can keep chaining
 * or apply it directly as a decorator.
 *
 * @example
 * // Fluent chain form
 * @table("users").withoutTimestamps()
 * export class User extends BaseModel { ... }
 *
 * @example
 * // Options-object form — same result, no parens needed on the decorator
 * @table("users", { timestamps: true })
 * export class User extends BaseModel { ... }
 *
 * @example
 * // Non-standard primary key
 * @table("posts").primaryKey("post_id")
 * export class Post extends BaseModel { ... }
 *
 * Soft deletes are opt-in via the `SoftDeletes` mixin, not `@table`:
 * `class Post extends Model.using(SoftDeletes) {}` — see /docs/orm/lifecycle.
 */
export interface TableDecoratorBuilder {
  /** Apply the decorator to a class constructor (called automatically by TS). */
  (target: ClassRef, context?: unknown): void;

  /** Enable automatic `created_at` / `updated_at` management. Default: on. */
  withTimestamps(): TableDecoratorBuilder;
  /** Disable automatic timestamp columns. */
  withoutTimestamps(): TableDecoratorBuilder;
  /** Override the primary key column name. Default: "id". */
  primaryKey(key: string): TableDecoratorBuilder;
}

/**
 * Fluent class decorator factory for configuring a `BaseModel` subclass.
 *
 * Accepts an optional `options` object as a second argument so you don't need to
 * chain methods if you prefer the inline form. Both styles are fully equivalent.
 *
 * ```ts
 * // Style A — fluent chain
 * @table("users").withoutTimestamps()
 * export class User extends BaseModel { ... }
 *
 * // Style B — options object
 * @table("users", { timestamps: true })
 * export class User extends BaseModel { ... }
 * ```
 *
 * Timestamps are **on by default** — use `.withoutTimestamps()` to opt out. Soft
 * deletes are **opt-in via the `SoftDeletes` mixin**: `extends Model.using(SoftDeletes)`.
 *
 * `@table` is the single, required way to configure a model: besides setting the
 * table name and options, it anchors the class's `@column`/relation registrations at
 * definition time (the decorator runs synchronously with the class in hand). Any class
 * that declares column or relation fields — including a subclass that ADDS fields — must
 * carry its own `@table`, or those fields won't register.
 */
export function table(tableName: string, options: TableOptions = {}): TableDecoratorBuilder {
  const config: TableConfig = {
    tableName,
    timestamps: options.timestamps ?? true,
    primaryKey: options.primaryKey ?? "id",
  };

  function apply(target: ClassRef, _context?: unknown): void {
    // Drain the @column / @relation registrations queued while this class's members were
    // decorated. @table is the definition-time anchor that owns this — see _metadata.ts.
    drainPendingMembers(target);
    const ctor = target as unknown as Record<string, unknown>;
    ctor.table = config.tableName;
    ctor.timestamps = config.timestamps;
    ctor.primaryKey = config.primaryKey;
    // NOTE: `softDeletes` is intentionally NOT set here — it's owned by the SoftDeletes
    // mixin (`static softDeletes = true`). Setting it from @table would clobber the
    // mixin's value back to the default on models that compose it.
  }

  apply.withTimestamps = (): TableDecoratorBuilder => {
    config.timestamps = true;
    return apply as TableDecoratorBuilder;
  };

  apply.withoutTimestamps = (): TableDecoratorBuilder => {
    config.timestamps = false;
    return apply as TableDecoratorBuilder;
  };

  apply.primaryKey = (key: string): TableDecoratorBuilder => {
    config.primaryKey = key;
    return apply as TableDecoratorBuilder;
  };

  return apply as TableDecoratorBuilder;
}
