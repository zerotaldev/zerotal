import { describe, it, expect, afterEach } from "bun:test";
import { SQL } from "bun";
import {
  BaseModel,
  _setBaseModelConnection,
  _getModelConnection,
  setConnectionResolver,
} from "../index.ts";
import { column } from "../model/decorators/column.ts";
import { table } from "../model/decorators/table.ts";

afterEach(() => {
  _setBaseModelConnection(null);
  setConnectionResolver(null);
});

describe("connection resolver (ORM <-> core decoupling)", () => {
  it("resolves the connection via the injected resolver", () => {
    const db = new SQL(":memory:");
    setConnectionResolver(() => db);
    expect(_getModelConnection()).toBe(db);
  });

  it("an explicit override takes priority over the resolver", () => {
    const fromResolver = new SQL(":memory:");
    const override = new SQL(":memory:");
    setConnectionResolver(() => fromResolver);
    _setBaseModelConnection(override);
    expect(_getModelConnection()).toBe(override);
  });

  it("throws a helpful error when neither override nor resolver is set", () => {
    setConnectionResolver(null);
    _setBaseModelConnection(null);
    expect(() => _getModelConnection()).toThrow(/No database connection/);
  });

  it('a resolver swallows its own errors and is treated as "no connection"', () => {
    setConnectionResolver(() => {
      throw new Error("boom");
    });
    _setBaseModelConnection(null);
    expect(() => _getModelConnection()).toThrow(/No database connection/);
  });

  it("model queries run end-to-end through the resolver (no Application needed)", async () => {
    const db = new SQL(":memory:");
    await db`CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT)`;
    setConnectionResolver(() => db);

    @table("notes", { timestamps: false })
    class Note extends BaseModel {
      @column({ type: "string" }) body!: string;
    }

    await Note.create({ body: "hi" });
    expect(await Note.all()).toHaveLength(1);
  });
});
