import { describe, it, expect } from "bun:test";
import { MakePolicyCommand, policyStub } from "./MakePolicyCommand.ts";

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

  it("policyStub generates a class extending Policy", () => {
    const output = policyStub("PostPolicy", "Post");
    expect(output).toContain("extends Policy<unknown>");
    expect(output).toContain("class PostPolicy");
    expect(output).toContain("view(");
    expect(output).toContain("create(");
    expect(output).toContain("update(");
    expect(output).toContain("delete(");
    expect(output).toContain("@zerotal/auth");
  });

  it("policyStub infers model name from policy name", () => {
    const output = policyStub("UserPolicy", "User");
    expect(output).toContain("User");
  });

  it("policyStub uses provided model name", () => {
    const output = policyStub("ArticlePolicy", "Post");
    expect(output).toContain("Post");
  });
});
