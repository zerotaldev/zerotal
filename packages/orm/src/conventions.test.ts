import { describe, it, expect } from "bun:test";
import { tableNameFor } from "@zerotal/core";
import { BaseModel, _setModelEventDispatcher } from "./model/BaseModel.ts";
import { column } from "./model/decorators/column.ts";
import { registerModel, columnsFor, modelByName } from "./model/decorators/_metadata.ts";
import { HookRegistry } from "./model/hooks/HookRegistry.ts";

describe("convention: registerModel (no @table)", () => {
  it("claims columns by probe and indexes the model by name", () => {
    class Widget extends BaseModel {
      @column({ type: "string" }) name!: string;
      @column({ type: "number" }) size!: number;
    }
    registerModel(Widget);
    const W = Widget as unknown as { table?: string };
    if (!W.table) W.table = tableNameFor(Widget.name); // mirrors the models concern

    const cols = columnsFor(Widget as unknown as Function)!;
    expect(cols.get("name")?.type).toBe("string");
    expect(cols.get("size")?.type).toBe("number");
    expect(W.table).toBe("widgets");
    expect(modelByName("Widget")).toBe(Widget as unknown as Function);
  });
});

describe("convention: dispatchesEvents bridge", () => {
  it("dispatches the mapped event after the lifecycle hook", async () => {
    class OrderPlaced {
      constructor(public order: unknown) {}
    }
    class Order extends BaseModel {
      static override dispatchesEvents = { created: OrderPlaced };
      @column() ref!: string;
    }
    registerModel(Order);

    const captured: object[] = [];
    _setModelEventDispatcher((e) => captured.push(e));

    const inst = new Order();
    await HookRegistry.run(Order as unknown as Function, "afterCreate", inst);

    expect(captured.length).toBe(1);
    expect(captured[0]).toBeInstanceOf(OrderPlaced);
    expect((captured[0] as OrderPlaced).order).toBe(inst);

    _setModelEventDispatcher(undefined);
  });

  it("does not dispatch for an unmapped hook", async () => {
    class Thing extends BaseModel {
      static override dispatchesEvents = {};
      @column() label!: string;
    }
    registerModel(Thing);

    const captured: object[] = [];
    _setModelEventDispatcher((e) => captured.push(e));
    await HookRegistry.run(Thing as unknown as Function, "afterUpdate", new Thing());

    expect(captured.length).toBe(0);
    _setModelEventDispatcher(undefined);
  });
});
