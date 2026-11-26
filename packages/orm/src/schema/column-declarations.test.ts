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

// The object form's `type` takes every shorthand the string form does. The runtime
// always resolved them, but the overload was typed with the six storage types, so
// `@column({ type: "date", nullable: true })` — the column `table.date()` makes — was a
// compile error, and so were `integer`, `float`, `array` and both encrypted forms.
// This block does not compile without the fix: `typecheck:tests` fails on it.
describe("@column object form takes every shorthand as its type", () => {
  @table("shorthand_events")
  class ShorthandEvent extends BaseModel {
    @column({ type: "date", nullable: true }) day?: Date | null;
    @column({ type: "integer", default: 0 }) seats!: number;
    @column({ type: "float" }) ratio!: number;
    @column({ type: "array", default: [] }) tags!: string[];
    @column({ type: "encrypted" }) secret!: string;
    @column({ type: "encrypted:json", nullable: true }) secretJson?: unknown;
    @column({ type: "date", cast: "datetime" }) startsAt!: unknown;
    @column("immutable_datetime") frozenAt!: unknown;
    @column("decimal:2", { nullable: true }) price?: string | null;
  }

  const cols = columnsFor(ShorthandEvent)!;
  const resolved = (name: string) => {
    const c = cols.get(name)!;
    return { type: c.type, cast: c.cast, nullable: c.nullable ?? false };
  };

  it("resolves each to its storage type and cast, keeping the other options", () => {
    expect(resolved("day")).toEqual({ type: "datetime", cast: "date", nullable: true });
    expect(resolved("seats")).toEqual({ type: "number", cast: "integer", nullable: false });
    expect(cols.get("seats")?.default).toBe(0);
    expect(resolved("ratio")).toEqual({ type: "number", cast: "float", nullable: false });
    expect(resolved("tags")).toEqual({ type: "json", cast: "array", nullable: false });
    expect(resolved("secret")).toEqual({ type: "text", cast: "encrypted", nullable: false });
    expect(resolved("secretJson")).toEqual({
      type: "text",
      cast: "encrypted:json",
      nullable: true,
    });
  });

  it("lets an explicit cast win over the shorthand's", () => {
    expect(resolved("startsAt")).toEqual({ type: "datetime", cast: "datetime", nullable: false });
  });

  it("types the two string-only casts the runtime always accepted", () => {
    expect(resolved("frozenAt")).toEqual({
      type: "datetime",
      cast: "immutable_datetime",
      nullable: false,
    });
    expect(resolved("price")).toEqual({ type: "number", cast: "decimal:2", nullable: true });
  });

  it("generates a date column the way a datetime is generated", () => {
    const day = cols.get("day")!;
    const schema: ModelSchema = {
      table: "shorthand_events",
      primaryKey: "id",
      timestamps: false,
      softDeletes: false,
      columns: [
        {
          name: "day",
          type: day.type,
          nullable: true,
          primary: false,
          default: undefined,
          unique: false,
          index: false,
        },
      ],
    };
    const out = generateMigrationContent("CreateShorthandEvents", {
      newTables: [{ schema }],
      newColumns: [],
    } as never);
    expect(out).toMatch(/table\.dateTime\(['"]day['"]\)\.nullable\(\)/);
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
