/**
 * Column declarations that generated schemas were previously unable to express:
 * a two-argument `@column`, a real TEXT type, and declared unique/plain indexes.
 *
 * The indexes are the correctness half. `migrate:generate` produced a good table
 * skeleton with no constraints of any kind — including on obvious foreign keys — so
 * uniqueness that the application depends on (a webhook idempotency key, an invoice
 * counter) had to be remembered and hand-written every time.
 */
import { describe, it, expect } from "bun:test";
import { column } from "./../model/decorators/column.ts";
import { columnsFor } from "./../model/decorators/_metadata.ts";
import { table } from "./../model/decorators/table.ts";
import { BaseModel } from "./../model/BaseModel.ts";
import { generateMigrationContent } from "./MigrationCodegen.ts";
import type { ModelSchema } from "./ModelInspector.ts";

describe("@column two-argument form", () => {
  @table("widgets")
  class Widget extends BaseModel {
    @column("string", { nullable: true }) label?: string | null;
    @column("integer", { nullable: true, default: 0 }) count?: number | null;
    @column("text") body!: string;
    @column("string", { unique: true }) sku!: string;
  }

  const cols = columnsFor(Widget)!;

  it("keeps the shorthand's type while applying the options", () => {
    expect(cols.get("label")?.type).toBe("string");
    expect(cols.get("label")?.nullable).toBe(true);
  });

  it("keeps the shorthand's cast alongside the options", () => {
    expect(cols.get("count")?.type).toBe("number");
    expect(cols.get("count")?.cast).toBe("integer");
    expect(cols.get("count")?.nullable).toBe(true);
    expect(cols.get("count")?.default).toBe(0);
  });

  it("resolves 'text' to its own storage type", () => {
    expect(cols.get("body")?.type).toBe("text");
  });

  it("carries unique through", () => {
    expect(cols.get("sku")?.unique).toBe(true);
  });
});

describe("generated migrations carry constraints", () => {
  const schema = (columns: ModelSchema["columns"]): ModelSchema => ({
    table: "invoices",
    primaryKey: "id",
    timestamps: true,
    softDeletes: false,
    columns,
  });

  const col = (over: Partial<ModelSchema["columns"][number]>): ModelSchema["columns"][number] => ({
    name: "x",
    type: "string",
    nullable: false,
    primary: false,
    default: undefined,
    unique: false,
    index: false,
    ...over,
  });

  it("emits a unique index for a unique column", () => {
    const out = generateMigrationContent("CreateInvoices", {
      newTables: [{ schema: schema([col({ name: "reference", unique: true })]) }],
      newColumns: [],
    } as never);

    expect(out).toContain("table.unique('reference');");
  });

  it("emits a plain index for an indexed column", () => {
    const out = generateMigrationContent("CreateInvoices", {
      newTables: [{ schema: schema([col({ name: "status", index: true })]) }],
      newColumns: [],
    } as never);

    expect(out).toContain("table.index('status');");
  });

  it("infers an index on a foreign-key-shaped column", () => {
    // An unindexed FK is a table scan on every join; the reference can't always be
    // inferred but the index can.
    const out = generateMigrationContent("CreateInvoices", {
      newTables: [{ schema: schema([col({ name: "customerId", type: "number" })]) }],
      newColumns: [],
    } as never);

    expect(out).toContain("table.index('customer_id');");
  });

  it("does not index an ordinary column", () => {
    const out = generateMigrationContent("CreateInvoices", {
      newTables: [{ schema: schema([col({ name: "note" })]) }],
      newColumns: [],
    } as never);

    expect(out).not.toContain("table.index(");
    expect(out).not.toContain("table.unique(");
  });

  it("emits a text column as text, not string", () => {
    const out = generateMigrationContent("CreateInvoices", {
      newTables: [{ schema: schema([col({ name: "body", type: "text" })]) }],
      newColumns: [],
    } as never);

    expect(out).toContain("table.text('body');");
  });
});
