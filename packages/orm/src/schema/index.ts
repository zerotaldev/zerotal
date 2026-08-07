/**
 * @module schema
 *
 * Internal barrel for the schema-builder and migration subsystem: the
 * {@link Schema} facade, the {@link Blueprint} table builder and its
 * {@link ColumnBuilder}/{@link ForeignKeyBuilder} column API, the
 * {@link Migration} base class and {@link MigrationRunner}, plus the introspection
 * and diffing helpers ({@link SchemaInspector}, {@link ModelInspector},
 * {@link SchemaDiffer}, {@link generateMigrationContent}) that power
 * `migrate:generate` and `synchronize`.
 *
 * This is not a public package entry point — its members are re-exported from the
 * package root (`@zerotal/orm`), which is where consumers should import them.
 */
export { Blueprint } from "./Blueprint.ts";
export { ColumnBuilder, ForeignIdColumnBuilder, ForeignKeyBuilder } from "./ColumnDefinition.ts";
export type { FKAction } from "./ColumnDefinition.ts";
export { Schema } from "./Schema.ts";
export { Migration } from "./Migration.ts";
export { MigrationRunner } from "./MigrationRunner.ts";
export type { MigrationEntry, MigrationRecord, MigrationStatus } from "./MigrationRunner.ts";
export { SchemaInspector } from "./SchemaInspector.ts";
export type { LiveColumn, LiveTable } from "./SchemaInspector.ts";
export { ModelInspector } from "./ModelInspector.ts";
export type { ModelColumn, ModelSchema } from "./ModelInspector.ts";
export { SchemaDiffer } from "./SchemaDiffer.ts";
export type { DiffResult, NewTable, NewColumn } from "./SchemaDiffer.ts";
export { generateMigrationContent } from "./MigrationCodegen.ts";
