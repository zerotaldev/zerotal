import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DB, _setDbConnection } from "./DB.ts";
import { _setBaseModelConnection } from "../model/BaseModel.ts";
import { Schema } from "../schema/Schema.ts";
import { SchemaInspector } from "../schema/SchemaInspector.ts";
import { _templateStrings } from "./templateStrings.ts";

/**
 * What Bun 1.4.4's `sql` does with the `strings` it is handed: a template object whose
 * `raw` shows up when you enumerate it is refused. Bun older than that accepts it, so
 * without this check the suite would pass on the very versions the fault does not bite.
 */
function assertTemplateObject(strings: unknown): void {
  if (
    Array.isArray(strings) &&
    "raw" in strings &&
    Object.prototype.propertyIsEnumerable.call(strings, "raw")
  ) {
    throw new TypeError(
      "The argument 'strings' has an enumerable 'raw' property, so it is not a template " +
        "object. Use sql.unsafe(), or define 'raw' with Object.defineProperty().",
    );
  }
}

/** A connection that applies {@link assertTemplateObject}, including inside transactions. */
function strict(conn: SQLInstance): SQLInstance {
  return new Proxy(conn as unknown as (...args: unknown[]) => unknown, {
    apply(target, thisArg, args) {
      assertTemplateObject(args[0]);
      return Reflect.apply(target, thisArg, args);
    },
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;
      if (prop === "begin" || prop === "savepoint") {
        return (...args: unknown[]) => {
          const callback = args[args.length - 1] as (
            inner: SQLInstance,
            ...r: unknown[]
          ) => unknown;
          args[args.length - 1] = (inner: SQLInstance, ...rest: unknown[]) =>
            callback(strict(inner), ...rest);
          return value.apply(target, args);
        };
      }
      return value.bind(target);
    },
  }) as unknown as SQLInstance;
}

let real: SQLInstance;

beforeAll(() => {
  real = new SQL(":memory:");
  const guarded = strict(real);
  _setDbConnection(guarded);
  _setBaseModelConnection(guarded);
});

afterAll(async () => {
  _setDbConnection(null);
  _setBaseModelConnection(null);
  await real.end();
});

// ── The helper ─────────────────────────────────────────────────────────────────

describe("_templateStrings()", () => {
  it("holds the strings it was given, with raw alongside", () => {
    const tpl = _templateStrings(["SELECT ", " AS n"]);
    expect([...tpl]).toEqual(["SELECT ", " AS n"]);
    expect([...tpl.raw]).toEqual(["SELECT ", " AS n"]);
  });

  it("leaves raw out of enumeration, as a real template object does", () => {
    const tpl = _templateStrings(["a", "b"]);
    expect(Object.keys(tpl)).toEqual(["0", "1"]);
    expect(Object.getOwnPropertyDescriptor(tpl, "raw")?.enumerable).toBe(false);
  });

  it("is frozen, as a real template object is", () => {
    expect(Object.isFrozen(_templateStrings(["a"]))).toBe(true);
  });

  it("neither freezes nor tags the array it was given", () => {
    const parts = ["a", "b"];
    _templateStrings(parts);
    expect(Object.isFrozen(parts)).toBe(false);
    expect(Object.getOwnPropertyDescriptor(parts, "raw")).toBeUndefined();
  });

  it("passes the strict check that the Object.assign form fails", () => {
    const parts = ["SELECT 1"];
    expect(() => assertTemplateObject(Object.assign([...parts], { raw: [...parts] }))).toThrow(
      /enumerable 'raw' property/,
    );
    expect(() => assertTemplateObject(_templateStrings(parts))).not.toThrow();
  });

  it("is accepted by Bun's own sql function", async () => {
    const rows = await real(_templateStrings(["SELECT ", " AS n"]), 7);
    expect(rows).toEqual([{ n: 7 }]);
  });
});

// ── The ORM, through a connection that rejects what Bun 1.4.4 rejects ───────────

describe("ORM queries under a strict template check", () => {
  it("DB.raw() — string form, with and without bindings", async () => {
    expect(await DB.raw("SELECT 1 AS n")).toEqual([{ n: 1 }]);
    expect(await DB.raw("SELECT ? AS a, ? AS b", [2, 3])).toEqual([{ a: 2, b: 3 }]);
  });

  it("DB.raw() — tagged form", async () => {
    const n = 4;
    expect(await DB.raw`SELECT ${n} AS n`).toEqual([{ n: 4 }]);
  });

  it("Schema and SchemaInspector — DDL, hasTable and introspection", async () => {
    await Schema.create("strict_items", (bp) => {
      bp.increments("id");
      bp.string("name");
    });
    expect(await Schema.hasTable("strict_items")).toBe(true);
    expect(await Schema.hasColumn("strict_items", "name")).toBe(true);
    expect(await SchemaInspector.tables()).toContain("strict_items");
    expect((await SchemaInspector.columns("strict_items"))?.map((c) => c.name)).toContain("name");
  });

  it("the query builder — insert, where, count and the interned templates", async () => {
    await DB.table("strict_items").insert({ name: "a" });
    await DB.table("strict_items").insert({ name: "b" });
    expect(await DB.table("strict_items").where("name", "a").count()).toBe(1);
    // A second pass takes the cached template for the same query shape.
    expect(await DB.table("strict_items").where("name", "b").count()).toBe(1);
    expect(await DB.table("strict_items").count()).toBe(2);
  });

  it("transactions — begin(), and the SAVEPOINT a nested one issues", async () => {
    await DB.transaction(async () => {
      await DB.table("strict_items").insert({ name: "outer" });
      await DB.transaction(async () => {
        await DB.table("strict_items").insert({ name: "inner" });
      });
    });
    expect(await DB.table("strict_items").where("name", "inner").count()).toBe(1);
  });
});

// ── Nothing builds the object by hand again ────────────────────────────────────

describe("no package builds a template object with an enumerable raw", () => {
  const packagesDir = join(import.meta.dir, "..", "..", "..");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
      return /\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) ? [path] : [];
    });
  }

  it("goes through _templateStrings() instead", () => {
    const offenders: string[] = [];
    for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      let files: string[];
      try {
        files = sourceFiles(join(packagesDir, pkg.name, "src"));
      } catch {
        continue; // a package with no src/
      }
      for (const file of files) {
        // The helper's docblock and this file's strict-check test name the old form.
        if (/templateStrings(\.test)?\.ts$/.test(file)) continue;
        const text = readFileSync(file, "utf8");
        if (/Object\.assign\([^;]*?\{\s*raw\s*[:,}]/s.test(text) || /\.raw\s*=[^=]/.test(text)) {
          offenders.push(file.slice(packagesDir.length + 1).replaceAll("\\", "/"));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
