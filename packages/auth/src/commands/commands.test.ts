import { describe, it, expect } from "bun:test";
import { MakePolicyCommand as CoreMakePolicyCommand } from "@zerotal/core/commands";
import { MakePolicyCommand } from "./MakePolicyCommand.ts";

describe("MakePolicyCommand", () => {
  it("declares static properties", () => {
    expect(MakePolicyCommand.commandName).toBe("make:policy");
    expect(MakePolicyCommand.description).toBe("Create a new authorization policy class");
    expect(MakePolicyCommand.needsApp).toBe(false);
    expect(MakePolicyCommand.args).toHaveLength(1);
    expect(MakePolicyCommand.args[0]!.name).toBe("name");
    expect(MakePolicyCommand.flags).toHaveLength(1);
    expect(MakePolicyCommand.flags[0]!.name).toBe("model");
  });

  // The CLI registers core's copy before any provider boots, so this package's copy was the one
  // that never ran, and the two drifted. There is one implementation now.
  it("is the command core registers, not a second copy", () => {
    expect(MakePolicyCommand).toBe(CoreMakePolicyCommand);
  });
});
