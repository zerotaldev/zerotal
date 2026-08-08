/**
 * `create()`'s payload type and the runtime's mass-assignment guard used to disagree.
 *
 * A non-optional column with a default — a compliance flag deliberately kept out of
 * `fillable` so it can never come from a request body — was *required* by
 * `InsertPayload`, so `create({...})` would not typecheck without it; including it threw
 * `MassAssignmentError`. There was no way to satisfy both.
 *
 * Declaring `fillable` as a literal tuple now narrows the payload to exactly the columns
 * the runtime will accept, so the type and the guard agree.
 */
import { describe, it, expect } from "bun:test";
import { BaseModel } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { MassAssignmentError } from "../errors/index.ts";

@table("customers")
class Customer extends BaseModel {
  static override fillable = ["name", "email"] as const;

  @column() name!: string;
  @column() email!: string;
  @column({ type: "boolean", cast: "boolean", default: false }) legalHold!: boolean;
}

describe("create() payload vs the mass-assignment guard", () => {
  it("accepts the fillable columns without the guarded one", () => {
    // The assertion that matters is that this file typechecks: `legalHold` is not
    // required here, where before it was demanded by the type and rejected at runtime.
    const payload = { name: "Ada", email: "ada@example.com" } satisfies Parameters<
      typeof Customer.create
    >[0];

    expect(payload.name).toBe("Ada");
  });

  it("still refuses a non-fillable key at runtime", () => {
    const customer = new Customer();

    expect(() => customer.fill({ legalHold: true } as never)).toThrow(MassAssignmentError);
  });

  it("leaves models without a literal fillable list unnarrowed", () => {
    @table("notes")
    class Note extends BaseModel {
      static override fillable: string[] = ["body"];

      @column() body!: string;
      @column() author!: string;
    }

    // `fillable` widened to string[] carries no literal information, so the payload is
    // the full InsertPayload exactly as before — no existing model changes shape.
    const payload = { body: "hi", author: "Ada" } satisfies Parameters<typeof Note.create>[0];

    expect(payload.author).toBe("Ada");
    // `author` is outside the runtime allowlist even though the type accepted it —
    // the guard is unchanged, only the type stayed wide.
    expect(Note._isFillable("author")).toBe(false);
  });
});
