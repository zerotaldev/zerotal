import { describe, it, expect } from "bun:test";
import { action, deleteAction } from "./index.ts";
import type { ActionContext } from "./index.ts";

function ctx(over: Partial<ActionContext> = {}): ActionContext {
  const flashes: string[] = [];
  return {
    resource: {} as any,
    page: { flash: (m: string) => flashes.push(m) } as any,
    base: "/admin",
    slug: "posts",
    ...over,
    // expose the captured flashes for assertions
    _flashes: flashes,
  } as any;
}

describe("Action", () => {
  it("runs its handler on execute", async () => {
    let ran = false;
    const a = action("publish").run(async () => {
      ran = true;
    });
    await a.execute(ctx());
    expect(ran).toBe(true);
  });

  it("flashes the success message after a handler that didn't redirect", async () => {
    const c = ctx();
    const a = action("publish")
      .successMessage("Published.")
      .run(async () => {});
    await a.execute(c);
    expect((c as any)._flashes).toContain("Published.");
  });

  it("authorize() gates visibility (ANDed with visible)", () => {
    const record = { id: 1 } as any;
    expect(
      action("edit")
        .authorize(() => false)
        .isVisibleFor(record, ctx()),
    ).toBe(false);
    expect(
      action("edit")
        .authorize(() => true)
        .isVisibleFor(record, ctx()),
    ).toBe(true);
    expect(
      action("edit")
        .visible(() => true)
        .authorize(() => false)
        .isVisibleFor(record, ctx()),
    ).toBe(false);
  });

  it("preset deleteAction requires confirmation", () => {
    expect(deleteAction()._confirm).toBeTruthy();
  });
});
