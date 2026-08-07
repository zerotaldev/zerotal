/** @jsxImportSource @zerotal/flow */
import { describe, it, expect } from "bun:test";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./Card.tsx";
import { Input } from "./Input.tsx";
import { Textarea } from "./Textarea.tsx";
import { Label } from "./Label.tsx";
import { Badge } from "./Badge.tsx";
import { Separator } from "./Separator.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { Avatar } from "./Avatar.tsx";

const classesOf = (html: string) => (html.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);

describe("<Card> family", () => {
  it("renders a themed card surface with children", () => {
    const { html } = Card({ children: "body" });
    expect(html).toStartWith("<div");
    expect(html).toContain("bg-card");
    expect(html).toContain("rounded-xl");
    expect(html).toContain(">body</div>");
  });

  it("sub-parts render their semantic elements", () => {
    expect(CardHeader({ children: "h" }).html).toContain("p-6");
    expect(CardTitle({ children: "t" }).html).toStartWith("<h3");
    expect(CardDescription({ children: "d" }).html).toContain("text-muted-foreground");
    expect(CardContent({ children: "c" }).html).toContain("pt-0");
    expect(CardFooter({ children: "f" }).html).toContain("items-center");
  });

  it("merges a class override and passes through attrs", () => {
    const { html } = Card({ class: "max-w-md", id: "card1", children: "x" });
    expect(html).toContain("max-w-md");
    expect(html).toContain('id="card1"');
  });
});

describe("<Input>", () => {
  it("renders a themed text input defaulting to type=text", () => {
    const { html } = Input({});
    expect(html).toStartWith("<input");
    expect(html).toContain('type="text"');
    expect(html).toContain("border-input");
    expect(html).toContain("focus-visible:ring-ring");
  });

  it("honors an explicit type and forwards attrs", () => {
    const { html } = Input({ type: "search", placeholder: "Search…" });
    expect(html).toContain('type="search"');
    expect(html).toContain('placeholder="Search…"');
  });
});

describe("<Textarea>", () => {
  it("renders a themed textarea", () => {
    const { html } = Textarea({ rows: 4 });
    expect(html).toStartWith("<textarea");
    expect(html).toContain("min-h-16");
    expect(html).toContain('rows="4"');
  });
});

describe("<Label>", () => {
  it("wraps the headless label with themed classes and the flow-label hook", () => {
    const { html } = Label({ for: "email", children: "Email" });
    expect(html).toStartWith("<label");
    expect(html).toContain("flow-label");
    expect(html).toContain("font-medium");
    expect(html).toContain('for="email"');
    expect(html).toContain(">Email</label>");
  });
});

describe("<Badge>", () => {
  it("renders default variant", () => {
    const { html } = Badge({ children: "New" });
    expect(html).toStartWith("<span");
    expect(html).toContain("bg-primary");
    expect(html).toContain(">New</span>");
  });

  it("applies a variant and lets class override win", () => {
    expect(Badge({ variant: "outline", children: "Draft" }).html).toContain("text-foreground");
    const c = classesOf(Badge({ class: "bg-red-500", children: "x" }).html);
    expect(c).toContain("bg-red-500");
    expect(c).not.toContain("bg-primary");
  });
});

describe("<Separator>", () => {
  it("is horizontal + decorative by default", () => {
    const { html } = Separator({});
    expect(html).toContain("h-px");
    expect(html).toContain("w-full");
    expect(html).toContain('role="none"');
  });

  it("vertical + non-decorative exposes a semantic separator", () => {
    const { html } = Separator({ orientation: "vertical", decorative: false });
    expect(html).toContain("w-px");
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
  });
});

describe("<Skeleton>", () => {
  it("renders a pulsing placeholder sized by class", () => {
    const { html } = Skeleton({ class: "h-4 w-32" });
    expect(html).toContain("animate-pulse");
    expect(classesOf(html)).toContain("h-4");
  });
});

describe("<Avatar>", () => {
  it("renders an image when src is provided", () => {
    const { html } = Avatar({ src: "/me.png", alt: "Me" });
    expect(html).toContain("<img");
    expect(html).toContain('src="/me.png"');
    expect(html).toContain('alt="Me"');
  });

  it("renders the fallback when src is absent", () => {
    const { html } = Avatar({ fallback: "AL" });
    expect(html).not.toContain("<img");
    expect(html).toContain(">AL</span>");
    expect(html).toContain("bg-muted");
  });
});
