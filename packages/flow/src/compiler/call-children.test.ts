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
  it("renders a package's function as the runtime does", async () => {
    // A package's helper is a value: `__()` from zerotal/i18n is the case that matters, and
    // pluralize() from core stands in for it here.
    const { compiled, runtime, render } = await bothWays(
      "PackagePage",
      page(
        "PackagePage",
        `import { pluralize } from "@zerotal/core";`,
        `<main><h1>{pluralize("project")} & {pluralize(this.noun)}</h1></main>`,
        "",
        `@expose noun = "team <beta>";`,
      ),
    );
    expect(render).toContain('__esc(pluralize("project"))');
    expect(compiled).toBe(runtime);
    expect(compiled).toContain("projects");
    expect(compiled).toContain("&lt;beta");
  });

  it("renders globals, in a .map() and a ternary branch too", async () => {
    const { compiled, runtime } = await bothWays(
      "GlobalsPage",
      page(
        "GlobalsPage",
        "",
        `<ul>
          <li>{String(total).padStart(3, "0")}</li>
          {days.map((d) => <li>{Math.round(d)}</li>)}
          {days.length > 1 ? <b>{JSON.stringify(label)}</b> : null}
        </ul>`,
        `const total = 7;
    const days = [1.4, 2.6];
    const label = "a & b";`,
      ),
    );
    expect(compiled).toBe(runtime);
    expect(compiled).toContain("<li>007</li>");
    expect(compiled).toContain("<li>1</li><li>3</li>");
    expect(compiled).toContain("<b>&quot;a &amp; b&quot;</b>");
  });
});

describe("a call that may return markup stays on the runtime", () => {
  // Markup a method returns is rendered by the runtime: a binding in it (`live`) and a class
  // component in it need the render context, which a compiled render does not run in. Compiled,
  // the first lost its binding without a word and the second threw.
  const cases: [string, string, string, string][] = [
    [
      "BindingPage",
      `<form>{this.field()}</form>`,
      `@expose q = "x";
  field() {
    return <input value={this.q} live />;
  }`,
      'flow:model.live="q"',
    ],
    [
      "MarkupPage",
      `<div>{this.badge()}</div>`,
      `@expose name = "Ada <admin>";
  badge() {
    return <span class="badge">{this.name}</span>;
  }`,
      '<span class="badge">Ada &lt;admin&gt;</span>',
    ],
    [
      "ListPage",
      `<ul>{this.items()}</ul>`,
      `@expose tags = ["a", "b & c"];
  items() {
    return this.tags.map((t) => <li>{t}</li>);
  }`,
      "<li>a</li><li>b &amp; c</li>",
    ],
  ];

  for (const [name, body, members, expected] of cases) {
    it(`${name}: says why, and the runtime renders it`, async () => {
      const file = join(TMP, `${name}.tsx`);
      const source = page(name, "", body, "", members);
      writeFileSync(file, source);
      expect(compile(source, file).blocked).toContain("may return markup");
      const mod = (await import(file)) as Record<string, new () => Component>;
      expect((await FlowTest.mount(mod[name]!)).html()).toContain(expected);
    });
  }

  it("treats a function from the app's own .tsx module, and an inherited method, as markup", () => {
    writeFileSync(
      join(TMP, "rows.tsx"),
      `export function row(t: string) { return <li>{t}</li>; }\n`,
    );
    const fromTsx = join(TMP, "TsxHelperPage.tsx");
    const tsxSource = page("TsxHelperPage", `import { row } from "./rows";`, `<ul>{row("a")}</ul>`);
    writeFileSync(fromTsx, tsxSource);
    expect(compile(tsxSource, fromTsx).blocked).toContain("may return markup");

    const inherited = join(TMP, "InheritedPage.tsx");
    const inheritedSource = page("InheritedPage", "", `<p>{this.helperFromBase()}</p>`);
    writeFileSync(inherited, inheritedSource);
    expect(compile(inheritedSource, inherited).blocked).toContain("may return markup");
  });

  // Each of these compiled once, and either threw or dropped a binding: a call is compiled only
  // when it is plainly a value.
  const reaches: [string, string, string, string, string][] = [
    ["NamespacePage", `import * as rows from "./rows";`, `<ul>{rows.row("a")}</ul>`, "", ""],
    ["BarrelPage", `import { row } from "./barrel";`, `<ul>{row("a")}</ul>`, "", ""],
    ["AliasPage", `import { row } from "@app/rows";`, `<ul>{row("a")}</ul>`, "", ""],
    [
      "IndirectPage",
      "",
      `<form>{this.outer()}</form>`,
      "",
      `@expose q = "x";
  outer() {
    return this.inner();
  }
  inner() {
    return <input value={this.q} live />;
  }`,
    ],
    ["FieldObjectPage", "", `<form>{this.ui.field()}</form>`, "", `ui = { field: () => "x" };`],
    // The app's own helpers, however they reach the page: any of them can return markup.
    ["AppHelperPage", `import { __ } from "./lang";`, `<h1>{__("projects.title")}</h1>`, "", ""],
    [
      "WrapperPage",
      `import { row } from "./rows";
function wrap() {
  return row("x");
}`,
      `<ul>{wrap()}</ul>`,
      "",
      "",
    ],
    ["AliasLocalPage", `import { row } from "./rows";`, `<ul>{f("a")}</ul>`, "const f = row;", ""],
    ["RequirePage", "", `<ul>{rq.row("a")}</ul>`, `const rq = require("./rows");`, ""],
    ["LocalArrowPage", "", `<form>{field()}</form>`, "const field = () => <input />;", ""],
    // Round four: a map over render functions, destructuring, a const copy of a field, a path
    // alias of another shape, and Flow's own JSX runtime.
    ["MapFnPage", "", `<form>{this.fns.map((f) => f(this))}</form>`, "", `fns = [() => "x"];`],
    [
      "MapParamPage",
      "",
      `<ul>{this.cols.map((c) => c.cell())}</ul>`,
      "",
      `cols = [{ cell: () => "x" }];`,
    ],
    [
      "DestructurePage",
      `import { make } from "./rows";`,
      `<ul>{field()}</ul>`,
      "const { field } = make;",
      "",
    ],
    [
      "FieldCopyPage",
      "",
      `<form>{ui.field()}</form>`,
      "const ui = this.ui;",
      `ui = { field: () => "x" };`,
    ],
    ["PagesAliasPage", `import { row } from "@pages/rows";`, `<ul>{row("a")}</ul>`, "", ""],
    [
      "JsxRuntimePage",
      `import { jsx } from "@zerotal/flow/jsx-runtime";`,
      `<ul>{jsx("li", {})}</ul>`,
      "",
      "",
    ],
    [
      "ShadowGlobalPage",
      "",
      `<ul>{String(1)}</ul>`,
      "const String = (n: number) => <li>{n}</li>;",
      "",
    ],
    [
      "MethodPage",
      "",
      `<ul><li>{this.words()}</li></ul>`,
      "",
      `words() {
    return ["x", "<y>"];
  }`,
    ],
    // Round five: a package's call handed the app's code, which it can call back.
    [
      "CollectArrowPage",
      `import { collect } from "@zerotal/core";`,
      `<form>{collect([this]).map((r) => r.q).toArray()}</form>`,
      "",
      `@expose q = "x";`,
    ],
    [
      "CollectMethodPage",
      `import { collect } from "@zerotal/core";`,
      `<form>{collect([1]).map(this.field).toArray()}</form>`,
      "",
      `field() {
    return "x";
  }`,
    ],
    [
      "CollectAppFnPage",
      `import { collect } from "@zerotal/core";
import { row } from "./rows";`,
      `<ul>{collect(["a"]).map(row).toArray()}</ul>`,
      "",
      "",
    ],
    [
      "MapParamToPackagePage",
      `import { collect } from "@zerotal/core";`,
      `<ul>{this.fns.map((f) => collect([1]).map(f).toArray())}</ul>`,
      "",
      `fns = [(n: number) => n];`,
    ],
    ["ReviverPage", "", `<p>{JSON.parse("0", () => 1)}</p>`, "", ""],
    // Round six: a function held where a value would be, handed to a package or a global.
    [
      "ArrowFieldPage",
      `import { collect } from "@zerotal/core";`,
      `<ul>{collect(this.rows).map(this.rowFn).toArray()}</ul>`,
      "",
      `rows = ["a"];
  rowFn = (r: string) => r;`,
    ],
    [
      "ImportedFnFieldPage",
      `import { collect } from "@zerotal/core";
import { row } from "./rows";`,
      `<ul>{collect(["a"]).map(this.fn).toArray()}</ul>`,
      "",
      `fn = row;`,
    ],
    [
      "InheritedArgPage",
      `import { collect } from "@zerotal/core";`,
      `<ul>{collect(["a"]).map(this.helperFromBase).toArray()}</ul>`,
      "",
      "",
    ],
    [
      "LocalCopyPage",
      `import { collect } from "@zerotal/core";`,
      `<ul>{collect(["a"]).map(f).toArray()}</ul>`,
      "const f = this.rowFn;",
      `rowFn = (r: string) => r;`,
    ],
    [
      "ElementAccessPage",
      `import { collect } from "@zerotal/core";`,
      `<ul>{collect(["a"]).map(this.fns[0]).toArray()}</ul>`,
      "",
      `fns = [(r: string) => r];`,
    ],
    [
      "GlobalThisPage",
      `import { collect } from "@zerotal/core";`,
      `<ul>{collect(["a"]).map(globalThis.x).toArray()}</ul>`,
      "",
      "",
    ],
    ["ReviverFieldPage", "", `<p>{JSON.parse("0", this.rev)}</p>`, "", `rev = () => 1;`],
    [
      "ShadowNamespacePage",
      "namespace Math { export const round = (n: number) => n; }",
      `<p>{Math.round(1)}</p>`,
      "",
      "",
    ],
  ];

  for (const [name, imports, body, lead, members] of reaches) {
    it(`${name}: stays on the runtime`, () => {
      writeFileSync(
        join(TMP, "rows.tsx"),
        `export function row(t: string) { return <li>{t}</li>; }\n`,
      );
      writeFileSync(join(TMP, "barrel.ts"), `export { row } from "./rows";\n`);
      const file = join(TMP, `${name}.tsx`);
      const source = page(name, imports, body, lead, members);
      writeFileSync(file, source);
      expect(compile(source, file).blocked).toContain("may return markup");
    });
  }

  it("compiles a call handed an object of values, keys and types included", () => {
    // `__("welcome", { name: this.q })` is the common translation call: its keys are names, not
    // variables, and a type assertion is not a value.
    const file = join(TMP, "ObjectArgPage.tsx");
    const source = page(
      "ObjectArgPage",
      `import { pluralize } from "@zerotal/core";`,
      `<p>{pluralize(JSON.stringify({ count: this.count, name: this.noun as string }))}</p>`,
      "",
      `@expose count = 3;
  @expose noun = "task";`,
    );
    writeFileSync(file, source);
    expect(compile(source, file).render).toContain("__esc(pluralize(JSON.stringify(");
  });

  it("compiles a static method of a package's class, and a namespace import from a package", () => {
    const file = join(TMP, "PackageStaticPage.tsx");
    const source = page(
      "PackageStaticPage",
      `import * as core from "@zerotal/core";`,
      `<p>{core.pluralize("task")}</p>`,
    );
    writeFileSync(file, source);
    expect(compile(source, file).render).toContain('__esc(core.pluralize("task"))');
  });
});

describe("a call in a text child, compiled", () => {
  it("compiles under cspSafe", () => {
    const file = join(TMP, "CspLangPage.tsx");
    const source = page(
      "CspLangPage",
      `import { pluralize } from "@zerotal/core";`,
      `<h1>{pluralize("project")}</h1>`,
    );
    writeFileSync(file, source);
    expect(compile(source, file, true).render).toContain('__esc(pluralize("project"))');
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
