import { describe, it, expect } from "bun:test";
import { BaseModel } from "./model/BaseModel.ts";
import { table } from "./model/decorators/table.ts";
import { column } from "./model/decorators/column.ts";
import { modelForParam, resolverForParam } from "./implicitBinding.ts";

// Unique names to avoid colliding with models registered by other test files in the shared
// global registry. Each declares a @column so @table drains the buffer and registers the
// model name (mirrors a real model; the convention loader also registers via registerModel()).
@table("ib_widgets")
class IbWidget extends BaseModel {
  @column() name!: string;
}

@table("ib_secrets")
class IbSecret extends BaseModel {
  @column() name!: string;
  static override implicitBinding = false;
}

@table("ib_writers")
class IbWriter extends BaseModel {
  @column() name!: string;
  static override implicitBindingKey = "ibAuthor";
}

describe("modelForParam — implicit route-model binding", () => {
  it("resolves a param to its model by class-name convention", () => {
    expect(modelForParam("ibWidget")).toBe(IbWidget as never);
  });

  it("resolves a plural param to the singular model", () => {
    expect(modelForParam("ibWidgets")).toBe(IbWidget as never);
  });

  it("skips a model with implicitBinding = false", () => {
    expect(modelForParam("ibSecret")).toBeUndefined();
  });

  it("honors implicitBindingKey over the name convention", () => {
    expect(modelForParam("ibAuthor")).toBe(IbWriter as never);
    // The class name itself no longer claims the param:
    expect(modelForParam("ibWriter")).toBeUndefined();
  });

  it("returns undefined when no model matches", () => {
    expect(modelForParam("somethingUnknown")).toBeUndefined();
  });
});

// ── static resolveRouteBinding — the model owns its own lookup ────────────────

@table("ib_members")
class IbMember extends BaseModel {
  @column() username!: string;

  static calls: Array<{ value: string; param: string }> = [];

  static async resolveRouteBinding(value: string, _ctx: never, param: string): Promise<unknown> {
    IbMember.calls.push({ value, param });
    return { resolvedBy: param, value };
  }
}

@table("ib_plains")
class IbPlain extends BaseModel {
  @column() name!: string;
  static findOrFailCalls: string[] = [];
  static override async findOrFail(id: number | string): Promise<never> {
    IbPlain.findOrFailCalls.push(String(id));
    return { viaFindOrFail: id } as never;
  }
}

describe("resolveRouteBinding — model-owned lookup", () => {
  it("uses the model's resolver instead of findOrFail", async () => {
    IbMember.calls = [];
    const resolver = resolverForParam("ibMember")!;

    const result = await resolver("jane", {} as never);

    expect(result).toEqual({ resolvedBy: "ibMember", value: "jane" });
    expect(IbMember.calls).toEqual([{ value: "jane", param: "ibMember" }]);
  });

  it("passes the param name so one model can answer for several segments", async () => {
    IbMember.calls = [];
    await resolverForParam("ibMembers")!("ana", {} as never);

    // :ibMembers resolves to the same model, but the resolver is told which segment matched.
    expect(IbMember.calls).toEqual([{ value: "ana", param: "ibMembers" }]);
  });

  it("falls back to a primary-key findOrFail when the model declares no resolver", async () => {
    IbPlain.findOrFailCalls = [];

    const result = await resolverForParam("ibPlain")!("42", {} as never);

    expect(result).toEqual({ viaFindOrFail: "42" } as never);
    expect(IbPlain.findOrFailCalls).toEqual(["42"]);
  });
});
