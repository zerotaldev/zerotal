import { describe, it, expect } from "bun:test";
import { CacheClearCommand } from "./CacheClearCommand.ts";

describe("CacheClearCommand", () => {
  it("has correct static properties", () => {
    expect(CacheClearCommand.commandName).toBe("cache:clear");
    expect(CacheClearCommand.needsApp).toBe(true);
    expect(CacheClearCommand.flags).toHaveLength(1);
    expect(CacheClearCommand.flags[0]!.name).toBe("driver");
  });
});
