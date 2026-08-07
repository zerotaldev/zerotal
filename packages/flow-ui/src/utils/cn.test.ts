import { describe, it, expect } from "bun:test";
import { cn } from "./cn.ts";

describe("cn()", () => {
  it("joins plain class strings", () => {
    expect(cn("px-4", "py-2")).toBe("px-4 py-2");
  });

  it("drops falsy values (clsx semantics)", () => {
    expect(cn("px-4", false, null, undefined, "py-2")).toBe("px-4 py-2");
    // eslint-disable-next-line no-constant-binary-expression -- deliberately testing clsx falsy handling
    expect(cn("a", 0 && "b", true && "c")).toBe("a c");
  });

  it("supports arrays and conditional objects", () => {
    expect(cn(["px-4", "py-2"])).toBe("px-4 py-2");
    expect(cn({ "text-red-500": true, hidden: false })).toBe("text-red-500");
  });

  it("lets a later conflicting Tailwind utility win (tailwind-merge)", () => {
    expect(cn("bg-primary", "bg-red-500")).toBe("bg-red-500");
    expect(cn("px-2 py-2", "px-4")).toBe("py-2 px-4");
  });

  it("merges responsive/variant-prefixed conflicts correctly", () => {
    expect(cn("p-4", "md:p-6", "p-2")).toBe("md:p-6 p-2");
  });
});
