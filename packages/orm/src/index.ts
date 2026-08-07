/**
 * A Bun-native Active Record ORM built on `Bun.sql`.
 *
 * Models extend {@link BaseModel}: you declare columns with {@link column | `@column`},
 * relationships with decorators like {@link hasMany | `@hasMany`} and
 * {@link belongsTo | `@belongsTo`}, and then query and persist through the model's
 * static and instance methods. Under the hood a {@link QueryBuilder} routes every
 * value through parameterised bindings and forces interpolated identifiers through
 * an allowlist; {@link ModelQueryBuilder} adds model hydration, eager loading, and
 * relationship-existence queries on top. Schema changes are authored as migrations
 * using the {@link Schema} facade and the {@link Blueprint} table builder.
 *
 * Mass assignment is **guarded by default** — a model with neither `fillable` nor
 * `guarded` declared rejects all attributes in {@link BaseModel.fill | `fill()`}.
 * Soft deletes and state machines are opt-in mixins composed via
 * {@link BaseModelWith}. The ORM's CLI commands (`migrate`, `make:model`, …) live
 * under the `@zerotal/orm/commands` subpath.
 *
 * @example Define a model
 * ```ts
 * import { BaseModel, column, hasMany, type HasMany } from "@zerotal/orm";
 * import { Post } from "./Post.ts";
 *
 * export class User extends BaseModel {
 *   @column({ primary: true }) id!: number;
 *   @column() email!: string;
 *   @column() name!: string;
 *
 *   @hasMany(() => Post) posts!: HasMany<Post>;
 * }
 * ```
 *
 * @example Query, create, and eager-load
 * ```ts
 * const active = await User.query()
 *   .where("active", true)
 *   .with("posts")
 *   .orderBy("name")
 *   .paginate(20, 1); // 20 per page, page 1
 *
 * const user = await User.create({ email: "a@b.com", name: "Ada" });
 * user.name = "Ada L.";
 * await user.save();
 * ```
 *
 * @example A migration
 * ```ts
 * import { Migration, Schema } from "@zerotal/orm";
 *
 * export default class extends Migration {
 *   async up() {
 *     await Schema.create("users", (table) => {
 *       table.increments("id");
 *       table.string("email").unique();
 *       table.timestamps();
 *     });
 *   }
 *   async down() {
 *     await Schema.drop("users");
 *   }
 * }
 * ```
 *
 * @remarks
 * Runs on **Bun ≥ 1.1** via `Bun.sql`; SQLite, Postgres, and MySQL dialects are
 * supported. Register `DatabaseProvider` to wire the ORM into an application.
 *
 * @packageDocumentation
 */

// @zerotal/orm — public API barrel

export { BaseModel, Model } from "./model/BaseModel.ts";
export { BaseModelWith } from "./model/mixins.ts";
export type { Constructor, Mixin } from "./model/mixins.ts";
// State-machine behaviour is an opt-in mixin — compose with `BaseModelWith(State)`.
export { State } from "./model/State.ts";
// Soft deletes are opt-in — compose with `BaseModelWith(SoftDeletes)`.
export { SoftDeletes } from "./model/SoftDeletes.ts";
export type {
  StateDefinition,
  StateMachine,
  StateGuard,
  RejectTransition,
  TransitionContext,
  TransitionResult,
  TransitionCallback,
} from "./model/State.ts";
export type { ScopeApplicator, Columns } from "./model/BaseModel.ts";
export type { InsertPayload, UpdatePayload } from "./model/payload.ts";
// Columns is also re-exported from payload.ts for import convenience — no duplicate needed here
export { ModelQueryBuilder, _globalScopeRegistry } from "./model/ModelQueryBuilder.ts";
export type { GlobalScopeCallback, RelationConstraint } from "./model/ModelQueryBuilder.ts";
export { DB } from "./db/DB.ts";
export {
  _getConnection,
  _setDbConnection,
  _getDbConnectionOverride,
  _setReadReplicas,
} from "./db/DB.ts";
export { setConnectionResolver, resolveContainerConnection } from "./db/resolver.ts";
export {
  OrmContext,
  currentOrmContext,
  useOrmContext,
  resetOrmContext,
} from "./model/OrmContext.ts";
export type { ManualTransaction } from "./db/DB.ts";
export { createReadWriteRouter } from "./db/ReadWriteRouter.ts";
export { TransactionContext } from "./db/TransactionContext.ts";
export {
  _setBaseModelConnection,
  _getModelConnection,
  _setBaseModelDialect,
  _getDialect,
  _resolveConn,
  registerModelConnection,
  registerConnectionResolver,
  _clearModelConnections,
} from "./model/BaseModel.ts";
export type { ContextConnectionResolver } from "./model/BaseModel.ts";
export type { SQLInstance } from "./db/sql-types.ts";
export { _clearTransitionCallbacks } from "./model/State.ts";
export { QueryBuilder, _setQueryBuilderDialect } from "./db/QueryBuilder.ts";

// Dialect strategies (engine-specific SQL: introspection, date parts, advisory locks)
export { getDialect, SqliteDialect, PostgresDialect, MysqlDialect } from "./db/dialects/index.ts";
export type { SqlDialect, DialectName, DialectQuery, DatePart } from "./db/dialects/index.ts";
export type {
  WhereOperator,
  OrderDirection,
  QueryState,
  PaginateResult,
  PaginateMeta,
  SimplePaginateResult,
  CursorPaginateResult,
  KeysetOptions,
  KeysetPaginateResult,
} from "./db/types.ts";

// Decorators
export { column, columnRegistry } from "./model/decorators/column.ts";
export type { ColumnOptions, ColumnShorthand } from "./model/decorators/column.ts";
export { registerModel, modelByName, modelsByName } from "./model/decorators/_metadata.ts";
// Imperative column registration — for mixin authors composing model behaviour with
// BaseModelWith (the @column decorator can't run inside a returned class expression).
export { registerColumn, columnsFor } from "./model/decorators/_metadata.ts";
export { table } from "./model/decorators/table.ts";
export type { TableDecoratorBuilder, TableOptions } from "./model/decorators/table.ts";
export { hasMany } from "./model/decorators/hasMany.ts";
export { belongsTo } from "./model/decorators/belongsTo.ts";
export { hasOne } from "./model/decorators/hasOne.ts";
export { manyToMany } from "./model/decorators/manyToMany.ts";
export type { ManyToManyOptions } from "./model/decorators/manyToMany.ts";
export { morphTo } from "./model/decorators/morphTo.ts";
export type { MorphToOptions } from "./model/decorators/morphTo.ts";
export { morphMany } from "./model/decorators/morphMany.ts";
export type { MorphManyOptions } from "./model/decorators/morphMany.ts";
export { morphOne } from "./model/decorators/morphOne.ts";
export type { MorphOneOptions } from "./model/decorators/morphOne.ts";
export { hasManyThrough } from "./model/decorators/hasManyThrough.ts";
export type { HasManyThroughOptions } from "./model/decorators/hasManyThrough.ts";
export { hasOneThrough } from "./model/decorators/hasOneThrough.ts";
export { morphToMany } from "./model/decorators/morphToMany.ts";
export type { MorphToManyOptions } from "./model/decorators/morphToMany.ts";
export { morphedByMany } from "./model/decorators/morphedByMany.ts";
export type { MorphedByManyOptions } from "./model/decorators/morphedByMany.ts";

// Relations
export { relationRegistry } from "./model/relations/RelationRegistry.ts";
export type {
  ManyToMany,
  HasMany,
  BelongsTo,
  HasOne,
  MorphTo,
  MorphMany,
  MorphOne,
  WithLoaded,
  RelationMetadata,
  RelationDefinition,
  RelationType,
} from "./model/relations/RelationRegistry.ts";

// Hooks
export { HookRegistry, _suppressHooks } from "./model/hooks/HookRegistry.ts";
export type { HookName } from "./model/hooks/HookRegistry.ts";

// Observers
export type { ModelObserver } from "./model/Observer.ts";

// N+1 detection
export { preventNPlusOne, allowNPlusOne, NPlusOneError } from "./db/NPlusOneDetector.ts";
export type { NPlusOneOptions } from "./db/NPlusOneDetector.ts";

// Errors
export {
  ModelNotFoundError,
  RelationNotLoadedError,
  TransactionError,
  MigrationError,
  StateError,
  UnsupportedDialectError,
} from "./errors/index.ts";

// Provider
export { DatabaseProvider, _normaliseSqliteUrl } from "./provider/DatabaseProvider.ts";
export { installOrmObservability } from "./observability.ts";

// Schema / Migrations
export { Blueprint } from "./schema/Blueprint.ts";
export {
  ColumnBuilder,
  ForeignIdColumnBuilder,
  ForeignKeyBuilder,
} from "./schema/ColumnDefinition.ts";
export type { FKAction } from "./schema/ColumnDefinition.ts";
export { Schema } from "./schema/Schema.ts";
export { Migration } from "./schema/Migration.ts";
export { MigrationRunner } from "./schema/MigrationRunner.ts";
export type { MigrationEntry, MigrationRecord, MigrationStatus } from "./schema/MigrationRunner.ts";
export { SchemaInspector } from "./schema/SchemaInspector.ts";
export type { LiveColumn, LiveTable } from "./schema/SchemaInspector.ts";
export { ModelInspector } from "./schema/ModelInspector.ts";
export type { ModelColumn, ModelSchema } from "./schema/ModelInspector.ts";
export { SchemaDiffer } from "./schema/SchemaDiffer.ts";
export type { DiffResult, NewTable, NewColumn, DroppedColumn } from "./schema/SchemaDiffer.ts";
export { synchronizeSchema, resolveSyncOptions } from "./schema/autoMigrate.ts";
export type { SynchronizeOptions, ResolvedSyncOptions } from "./schema/autoMigrate.ts";
export { generateMigrationContent } from "./schema/MigrationCodegen.ts";

// Implicit route-model binding
export { modelForParam, registerImplicitBinding } from "./implicitBinding.ts";

// Seeding
export { Seeder } from "./seeding/Seeder.ts";

// Config factory
export { DatabaseConfig } from "./config.ts";
export type { DatabaseConfigShape } from "./config.ts";

// Casts
export { Cast, JsonCast, ArrayCast, json, objectOf, arrayOf } from "./casts/Cast.ts";
export type { CastContract, CastMapper, CastField } from "./casts/Cast.ts";

// Framework events emitted by the ORM (subscribe via core's FrameworkEvents bus).
export {
  QueryExecuted,
  NPlusOneDetected,
  TransactionStarted,
  TransactionCommitted,
  TransactionRolledBack,
  MigrationRan,
  ModelChanged,
} from "./events.ts";
