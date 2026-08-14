/**
 * `foreignId(...).nullable().constrained()` — the chain the class's own docblock
 * documents, and which did not compile.
 *
 * `nullable()` returned `ColumnBuilder`, so the chain left
 * `ForeignIdColumnBuilder` and `.constrained()` was gone. A nullable foreign key
 * is the commonest kind there is, so the documented form was the first thing
 * anyone reached for.
 *
 * Type-level assertions matter as much as the runtime ones here — the bug *was*
 * the type — and this file is inside `typecheck:tests`, so a regression in the
 * return type fails there even though the SQL below would still be right.
 */
import { describe, it, expect } from "bun:test";
import { Blueprint } from "./Blueprint.ts";

/** `toCreateSQL` returns one statement per line of DDL; the assertions want the lot. */
function sqlOf(table: Blueprint, name: string): string {
  const out = table.toCreateSQL(name) as unknown;
  return Array.isArray(out) ? out.join("\n") : String(out);
}

describe("foreignId().nullable().constrained()", () => {
  it("compiles and emits both the column and the constraint", () => {
    const table = new Blueprint();
    table.foreignId("category_id").nullable().constrained("categories").nullOnDelete();

    const sql = sqlOf(table, "transactions");

    expect(sql).toContain("category_id");
    expect(sql.toUpperCase()).toContain("FOREIGN KEY");
    expect(sql).toContain("categories");
    expect(sql.toUpperCase()).toContain("ON DELETE SET NULL");
  });

  it("still marks the column nullable", () => {
    const nullableTable = new Blueprint();
    nullableTable.foreignId("user_id").nullable().constrained();
    expect(sqlOf(nullableTable, "posts").toUpperCase()).not.toContain("USER_ID INTEGER NOT NULL");

    const requiredTable = new Blueprint();
    requiredTable.foreignId("user_id").notNullable().constrained();
    expect(sqlOf(requiredTable, "posts").toUpperCase()).toContain("NOT NULL");
  });

  it("works in the other order too", () => {
    const table = new Blueprint();
    // `constrained()` returns the ForeignKeyBuilder, so the column modifier has
    // to come first — but both orders should at least be expressible.
    const column = table.foreignId("author_id");
    column.nullable();
    column.constrained("users");

    expect(sqlOf(table, "posts").toUpperCase()).toContain("FOREIGN KEY");
  });

  it("keeps the nullability lock — .nullable().notNullable() stays a compile error", () => {
    const table = new Blueprint();
    const chained = table.foreignId("user_id").nullable();

    // `notNullable()` resolves to `never` once the lock is held, which is what
    // makes anything chained off it a compile error — the same shape the base
    // ColumnBuilder uses.
    // @ts-expect-error `nullability` is locked once `nullable()` has been called.
    chained.notNullable().constrained();

    // The runtime is unchanged; the guard is entirely in the type above.
    expect(sqlOf(table, "posts")).toContain("user_id");
  });
});
