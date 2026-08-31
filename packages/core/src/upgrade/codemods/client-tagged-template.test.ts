import { describe, it, expect } from "bun:test";
import { clientTaggedTemplate } from "./client-tagged-template.ts";

const run = (contents: string) => clientTaggedTemplate.run([{ file: "a.ts", contents }]);

describe("client → $ codemod", () => {
  it("rewrites a plain template literal", () => {
    const r = run("this.client(`$refs.titleInput.focus()`);");
    expect(r.changes[0]!.contents).toBe("this.$`$refs.titleInput.focus()`;");
    expect(r.manual).toHaveLength(0);
  });

  it("rewrites a single-quoted string", () => {
    const r = run("this.client('alert(1)');");
    expect(r.changes[0]!.contents).toBe("this.$`alert(1)`;");
  });

  it("rewrites a double-quoted string", () => {
    const r = run('this.client("alert(1)");');
    expect(r.changes[0]!.contents).toBe("this.$`alert(1)`;");
  });

  it("hands back a variable argument rather than wrapping it", () => {
    // Wrapping would encode the expression as a string literal and stop running it.
    const r = run("this.client(script);");
    expect(r.changes).toHaveLength(0);
    expect(r.manual).toHaveLength(1);
    expect(r.manual[0]!.reason).toContain("encode the whole thing as a string literal");
  });

  it("hands back a concatenation — the shape the security note was about", () => {
    const r = run("this.client('toast(' + userInput + ')');");
    expect(r.changes).toHaveLength(0);
    expect(r.manual).toHaveLength(1);
  });

  it("hands back a template that already interpolates", () => {
    // These are exactly where the escaping question is live.
    const r = run("this.client(`toast(${this.search})`);");
    expect(r.changes).toHaveLength(0);
    expect(r.manual).toHaveLength(1);
  });

  it("leaves this.$ alone", () => {
    const r = run("this.$`already migrated`;");
    expect(r.changes).toHaveLength(0);
    expect(r.manual).toHaveLength(0);
  });

  it("does not match a different object's client()", () => {
    const r = run("api.client('x');");
    expect(r.changes).toHaveLength(0);
    expect(r.manual).toHaveLength(0);
  });

  it("handles several calls in one file", () => {
    const r = run("this.client(`a()`);\nthis.client(`b()`);");
    expect(r.changes[0]!.contents).toBe("this.$`a()`;\nthis.$`b()`;");
  });

  it("is registered for 1.13.0 and cites its ledger entry", () => {
    expect(clientTaggedTemplate.version).toBe("1.13.0");
    expect(clientTaggedTemplate.ledger).toBe(5);
  });
});
