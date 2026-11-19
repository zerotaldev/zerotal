import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compile } from "tailwindcss";
import { flowTailwindCss, flowTokensCss, flowUiHead } from "./theme.ts";

/** Compile the theme CSS with Tailwind v4, the compiler the browser build bundles. */
async function build(candidates: string[]): Promise<string> {
  const root = dirname(require.resolve("tailwindcss/package.json"));
  const compiler = await compile(`@import "tailwindcss";\n${flowTailwindCss()}`, {
    base: root,
    loadStylesheet: async (id: string) => {
      const file = id === "tailwindcss" ? "index.css" : id.replace(/^tailwindcss\//, "");
      return {
        path: join(root, file),
        base: root,
        content: readFileSync(join(root, file), "utf8"),
      };
    },
  });
  return compiler.build(candidates);
}

/** The text of the first `<style>` whose opening tag matches. */
function styleBlock(head: string, open: string): string {
  const start = head.indexOf(open);
  if (start < 0) return "";
  return head.slice(start + open.length, head.indexOf("</style>", start));
}

describe("flowUiHead()", () => {
  it("loads Tailwind's v4 browser build from a pinned URL with an integrity hash", () => {
    const head = flowUiHead("Acme");
    expect(head).toMatch(
      /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@\d+\.\d+\.\d+\/dist\/index\.global\.js" integrity="sha384-[A-Za-z0-9+/=]{64}" crossorigin="anonymous"><\/script>/,
    );
    expect(head).not.toContain("cdn.tailwindcss.com");
    expect(head).not.toContain("tailwind.config");
  });

  it("hands the browser build the theme as a text/tailwindcss stylesheet after the script", () => {
    const head = flowUiHead("Acme");
    const css = styleBlock(head, `<style type="text/tailwindcss">`);
    expect(css).toBe(flowTailwindCss());
    expect(head.indexOf("@tailwindcss/browser")).toBeLessThan(
      head.indexOf(`<style type="text/tailwindcss">`),
    );
  });

  it("keeps the border and body rules out of the unlayered tokens when the CDN is on", () => {
    const tokens = styleBlock(flowUiHead("Acme"), "<style>");
    expect(tokens).toContain("--primary: 243 75% 59%;");
    expect(tokens).toContain("[x-cloak]");
    expect(tokens).not.toContain("border-color: hsl(var(--border))");
    expect(tokens).not.toContain("body {");
  });

  it("appends tokensCss after the defaults", () => {
    const tokens = styleBlock(
      flowUiHead("Acme", { tokensCss: ":root { --primary: 1 2% 3%; }" }),
      "<style>",
    );
    expect(tokens.endsWith(":root { --primary: 1 2% 3%; }")).toBe(true);
  });

  it("drops the CDN for a stylesheet and keeps every base rule unlayered", () => {
    const head = flowUiHead("Acme", { stylesheet: "/app.css" });
    expect(head).not.toContain("@tailwindcss/browser");
    expect(head).not.toContain("text/tailwindcss");
    expect(head).toContain(`<link rel="stylesheet" href="/app.css" />`);
    expect(styleBlock(head, "<style>")).toBe(flowTokensCss());
  });
});

describe("flowTokensCss()", () => {
  it("still carries the base rules for a page without the CDN", () => {
    const css = flowTokensCss();
    expect(css).toContain("* { border-color: hsl(var(--border)); }");
    expect(css).toContain("background-color: hsl(var(--background));");
  });
});

describe("flowTailwindCss() under Tailwind v4", () => {
  it("maps each token to a utility that reads the variable where it is used", async () => {
    const css = await build([
      "bg-primary",
      "text-muted-foreground",
      "border-input",
      "hover:bg-primary/90",
    ]);
    expect(css).toContain("background-color: hsl(var(--primary));");
    expect(css).toContain("color: hsl(var(--muted-foreground));");
    expect(css).toContain("border-color: hsl(var(--input));");
    expect(css).toContain("color-mix(in oklab, hsl(var(--primary)) 90%, transparent)");
  });

  it("keys dark: off a .dark ancestor, as Tailwind v3's class strategy did", async () => {
    const css = await build(["dark:bg-card"]);
    expect(css).toContain(".dark\\:bg-card:is(.dark *)");
  });

  it("keeps the token radii, the fonts and the fade-in animation", async () => {
    const css = await build([
      "rounded-sm",
      "rounded-md",
      "rounded-lg",
      "font-sans",
      "animate-fade-in",
    ]);
    expect(css).toContain("border-radius: calc(var(--radius) - 4px);");
    expect(css).toContain("border-radius: calc(var(--radius) - 2px);");
    expect(css).toContain("border-radius: var(--radius);");
    expect(css).toMatch(/font-family: Inter, ui-sans-serif/);
    expect(css).toContain("animation: fade-in .25s ease-out both;");
    expect(css).toContain("@keyframes fade-in");
  });

  it("puts the page defaults in the base layer, below every utility", async () => {
    const css = await build(["border-primary"]);
    const base = css.lastIndexOf("@layer base {");
    expect(base).toBeGreaterThan(-1);
    const layer = css.slice(base);
    expect(layer).toContain("border-color: hsl(var(--border));");
    expect(layer).toContain("color: #9ca3af;");
    expect(layer).toContain("cursor: pointer;");
    expect(layer).toContain("margin: auto;");
  });

  it("centres the container with one 1400px step", async () => {
    const css = await build(["container"]);
    expect(css).toContain("padding-inline: 1.5rem;");
    expect(css).toContain("max-width: none;");
    expect(css).toMatch(/@media \(width >= 1400px\) \{\s*\.container \{\s*max-width: 1400px;/);
  });
});
