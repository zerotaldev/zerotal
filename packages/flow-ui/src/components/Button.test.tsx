/** @jsxImportSource @zerotal/flow */
import { describe, it, expect } from "bun:test";
import { Button, buttonVariants } from "./Button.tsx";

describe("<Button>", () => {
  it("renders a button with default variant + size classes", () => {
    const { html } = Button({ children: "Save" });
    expect(html).toStartWith("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain("bg-primary");
    expect(html).toContain("h-9");
    expect(html).toContain(">Save</button>");
  });

  it("applies the requested variant and size", () => {
    const { html } = Button({ variant: "destructive", size: "sm", children: "Delete" });
    expect(html).toContain("bg-destructive");
    expect(html).toContain("h-8");
    expect(html).not.toContain("bg-primary");
  });

  it("lets a class override beat the variant default", () => {
    const { html } = Button({ class: "bg-red-500", children: "X" });
    // tailwind-merge drops the standalone `bg-primary` background utility in favour
    // of `bg-red-500` (the `hover:bg-primary/90` variant is a different utility and
    // legitimately stays), so check the class tokens precisely, not by substring.
    const classes = (html.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
    expect(classes).toContain("bg-red-500");
    expect(classes).not.toContain("bg-primary");
  });

  it("honors an explicit type and passes through extra attrs", () => {
    const { html } = Button({ type: "submit", id: "go", disabled: true, children: "Go" });
    expect(html).toContain('type="submit"');
    expect(html).toContain('id="go"');
    expect(html).toContain("disabled");
  });

  it("exposes buttonVariants for composing class strings directly", () => {
    expect(buttonVariants({ variant: "ghost" })).toContain("hover:bg-accent");
  });
});
