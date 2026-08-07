import { describe, it, expect } from "bun:test";
import { gva } from "./gva.ts";

const button = gva("inline-flex rounded-md", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      outline: "border border-input bg-background",
      ghost: "hover:bg-accent",
    },
    size: {
      default: "h-9 px-4",
      sm: "h-8 px-3",
      lg: "h-10 px-6",
    },
  },
  compoundVariants: [{ variant: "outline", size: "sm", class: "px-2" }],
  defaultVariants: { variant: "default", size: "default" },
});

describe("gva()", () => {
  it("applies base + default variants when called with no args", () => {
    const cls = button();
    expect(cls).toContain("inline-flex");
    expect(cls).toContain("rounded-md");
    expect(cls).toContain("bg-primary");
    expect(cls).toContain("h-9");
  });

  it("selects the requested variant and size", () => {
    const cls = button({ variant: "outline", size: "lg" });
    expect(cls).toContain("border-input");
    expect(cls).toContain("h-10");
    expect(cls).not.toContain("bg-primary");
  });

  it("applies compound variants only when every condition matches", () => {
    expect(button({ variant: "outline", size: "sm" })).toContain("px-2");
    // size sm alone (default variant) must NOT trigger the outline+sm compound
    expect(button({ size: "sm" })).not.toContain("px-2");
  });

  it("lets a class override win over the variant default (tailwind-merge)", () => {
    const cls = button({ variant: "default", class: "bg-red-500" });
    expect(cls).toContain("bg-red-500");
    expect(cls).not.toContain("bg-primary");
  });

  it("accepts className as an alias for class", () => {
    expect(button({ className: "w-full" })).toContain("w-full");
  });

  it("works with no variants config (base + override only)", () => {
    const plain = gva("p-4");
    expect(plain()).toBe("p-4");
    expect(plain({ class: "p-2" })).toBe("p-2");
  });
});
