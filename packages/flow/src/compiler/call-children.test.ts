/**
 * A function call as a text child compiles.
 *
 * `{__("k")}`, `{formatDate(x)}` and `{this.label()}` used to send a page to the runtime renderer,
 * and under `cspSafe` stop the boot, though the same call compiled in an attribute or hoisted into
 * a leading const. A call now compiles to `__esc(call)`, which renders its result the way the
 * runtime renders a child. Each case renders one page both ways, compiled and through the runtime,
 * and the two must give the same HTML.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transformFlowFile, type BlockerReport } from "./transform.ts";
import { FlowTest } from "../testing.ts";
import type { Component } from "../Component.ts";

const TMP = join(import.meta.dir, "__calls__");
const PRAGMA = "/** @jsxImportSource @zerotal/flow */\n";
const HELPERS = `import { __esc, __escAttr, __attr } from '@zerotal/flow/compiler-helpers';\n`;

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  mkdirSync(TMP, { recursive: true });
  // A translation function of the usual shape: a key, and replacements for its `:name` slots.
  writeFileSync(
    join(TMP, "lang.ts"),
    `const LINES: Record<string, string> = {
  "projects.title": "Projects & teams",
  "projects.count": "You're on :count projects <beta>",
};
export function __(key: string, replace: Record<string, string | number> = {}): string {
  let line = LINES[key] ?? key;
  for (const [name, value] of Object.entries(replace)) line = line.replace(":" + name, String(value));
  return line;
}
`,
  );
  writeFileSync(
    join(TMP, "format.ts"),
    `export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10) + " <UTC>";
}
`,
  );
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A page whose render() returns `body`, after `lead`. */
function page(name: string, imports: string, body: string, lead = "", members = ""): string {
  return `${PRAGMA}import { Component } from "../../Component.ts";
import { expose } from "../../decorators.ts";
${imports}

export class ${name} extends Component {
  ${members}
  override async render() {
    ${lead}
    return (${body});
  }
}
`;
}

let seq = 0;

/** Compile the page, or say what stopped it. */
function compile(
  source: string,
  file: string,
  cspSafe = false,
): { body?: string; render?: string; blocked?: string } {
  const report: BlockerReport = {};
  const out = transformFlowFile(source, file, { report, cspSafe });
  if (!out) return { blocked: `${report.blocker?.reason ?? "?"} -> ${report.blocker?.fix ?? ""}` };
  return {
    render: out.renderBody,
    body: `${HELPERS}${out.preamble}\nexport async function render() {\n${out.renderBody}\n}\n`,
  };
}

/** Render one page compiled and through the runtime; both HTML strings, and the compiled body. */
async function bothWays(
  name: string,
  source: string,
): Promise<{ compiled: string; runtime: string; render: string }> {
  const file = join(TMP, `${name}.tsx`);
  writeFileSync(file, source);
  const built = compile(source, file);
  if (!built.body) throw new Error(`did not compile: ${built.blocked}`);
  const compiledFile = join(TMP, `${name}.compiled${seq++}.ts`);
  writeFileSync(compiledFile, built.body);

  const mod = (await import(file)) as Record<string, new () => Component>;
  const Page = mod[name]!;
  const runtime = (await FlowTest.mount(Page)).html();
  const { render } = (await import(compiledFile)) as {
    render: (this: Component) => Promise<{ html: string }>;
  };
  const compiled = (await render.call(new Page())).html;
  return { compiled, runtime, render: built.render ?? "" };
}

describe("a call in a text child compiles", () => {
  it("renders a translation call as the runtime does", async () => {
    const { compiled, runtime, render } = await bothWays(
      "LangPage",
      page(
        "LangPage",
        `import { __ } from "./lang";`,
        `<main><h1>{__("projects.title")}</h1><p>{__("projects.count", { count: this.count })}</p></main>`,
        "",
        "@expose count = 3;",
      ),
    );
    expect(render).toContain('__esc(__("projects.title"))');
    expect(compiled).toBe(runtime);
    expect(compiled).toContain("<h1>Projects &amp; teams</h1>");
    expect(compiled).toContain("You&#x27;re on 3 projects &lt;beta&gt;");
  });

  it("renders a helper call, in a .map() and a ternary branch too", async () => {
    const { compiled, runtime } = await bothWays(
      "DatePage",
      page(
        "DatePage",
        `import { formatDate } from "./format";`,
        `<ul>
          <li>{formatDate(start)}</li>
          {days.map((d) => <li>{formatDate(d)}</li>)}
          {days.length > 1 ? <b>{String(days.length).padStart(3, "0")}</b> : null}
          <li>{label?.toUpperCase()}</li>
        </ul>`,
        `const start = new Date(Date.UTC(2026, 10, 27));
    const days = [new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 1, 2))];
    const label: string | undefined = "a & b";`,
      ),
    );
    expect(compiled).toBe(runtime);
    expect(compiled).toContain("<li>2026-11-27 &lt;UTC&gt;</li>");
    expect(compiled).toContain("<li>2026-02-02 &lt;UTC&gt;</li>");
    expect(compiled).toContain("<b>002</b>");
    expect(compiled).toContain("<li>A &amp; B</li>");
  });

  it("renders a method that returns markup as that markup", async () => {
    const { compiled, runtime } = await bothWays(
      "MarkupPage",
      page(
        "MarkupPage",
        "",
        `<div>{this.badge()}</div>`,
        "",
        `@expose name = "Ada <admin>";
  badge() {
    return <span class="badge">{this.name}</span>;
  }`,
      ),
    );
    expect(compiled).toBe(runtime);
    expect(compiled).toContain('<span class="badge">Ada &lt;admin&gt;</span>');
  });

  it("renders a method that returns an array item by item", async () => {
    const { compiled, runtime } = await bothWays(
      "ArrayPage",
      page(
        "ArrayPage",
        "",
        `<ul>{this.items()}<li>{this.words()}</li></ul>`,
        "",
        `@expose tags = ["a", "b & c"];
  items() {
    return this.tags.map((t) => <li>{t}</li>);
  }
  words() {
    return ["x", "<y>", null, 2];
  }`,
      ),
    );
    expect(compiled).toBe(runtime);
    expect(compiled).toContain("<li>a</li><li>b &amp; c</li>");
    expect(compiled).toContain("<li>x&lt;y&gt;2</li>");
  });

  it("compiles under cspSafe", () => {
    const file = join(TMP, "CspLangPage.tsx");
    const source = page(
      "CspLangPage",
      `import { __ } from "./lang";`,
      `<h1>{__("projects.title")}</h1>`,
    );
    writeFileSync(file, source);
    expect(compile(source, file, true).render).toContain('__esc(__("projects.title"))');
  });

  it("leaves a call that awaits on the runtime, and says why", () => {
    const file = join(TMP, "AwaitPage.tsx");
    const source = page(
      "AwaitPage",
      `import { formatDate } from "./format";`,
      `<p>{formatDate(await load())}</p>`,
      "const load = async () => new Date();",
    );
    writeFileSync(file, source);
    expect(compile(source, file).blocked).toContain("awaits in a text child");
  });

  it("still refuses a client-only magic passed to a call in a ternary branch", () => {
    const file = join(TMP, "MagicPage.tsx");
    const source = page(
      "MagicPage",
      "",
      `<p>{ok ? String(this.currentUrl()) : <i>none</i>}</p>`,
      "const ok = true;",
    );
    writeFileSync(file, source);
    expect(() => compile(source, file)).toThrow(/client-only magic/);
  });
});
