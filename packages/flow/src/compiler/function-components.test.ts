/**
 * A compiled page can use the app's own function components.
 *
 * Every capitalised tag used to send a page to the runtime renderer, and under `cspSafe` stop the
 * boot. So a starter that wanted its pages compiled wrote every form out by hand, twice for create
 * and edit, and could use none of its own components (walk item S6).
 *
 * A component imported from one of the app's modules is now called from the compiled page, when
 * its markup compiles under the same rules as a page's: no handlers, no client directives, no
 * `this`. Each case renders one page both ways, compiled and through the runtime, and the two
 * must give the same HTML.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transformFlowFile, type BlockerReport } from "./transform.ts";
import { readComponentImports } from "./constants.ts";
import { FlowTest } from "../testing.ts";
import type { Component } from "../Component.ts";

const TMP = join(import.meta.dir, "__components__");
const PRAGMA = "/** @jsxImportSource @zerotal/flow */\n";
const HELPERS = `import { __esc, __escAttr, __attr } from '@zerotal/flow/compiler-helpers';\n`;

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  mkdirSync(join(TMP, "components"), { recursive: true });

  // A form shared between two pages, with a class list from a module of its own.
  writeFileSync(join(TMP, "ui.ts"), `export const INPUT = "input w-full";\n`);
  writeFileSync(
    join(TMP, "components", "Field.tsx"),
    `${PRAGMA}import { INPUT } from "../ui";

export function Field(props: { name: string; label: string; value: string; error?: string }) {
  const id = \`field-\${props.name}\`;
  return (
    <div class="field">
      <label for={id}>{props.label}</label>
      <input id={id} name={props.name} class={INPUT} value={props.value} aria-invalid={props.error ? "true" : undefined} />
      {props.error ? <p class="error">{props.error}</p> : null}
    </div>
  );
}
`,
  );
  writeFileSync(
    join(TMP, "components", "ProjectForm.tsx"),
    `${PRAGMA}import { Field } from "./Field";

export const ProjectForm = (props: { action: string; values: { name: string }; submit: string; errors: Record<string, string> }) => (
  <form method="post" action={props.action}>
    <Field name="name" label="Name" value={props.values.name} error={props.errors["name"]} />
    <button type="submit">{props.submit}</button>
  </form>
);
`,
  );
  writeFileSync(
    join(TMP, "components", "Card.tsx"),
    `${PRAGMA}function Card(props: { title: string; children?: unknown }) {
  return (
    <section class="card">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}
export default Card;
`,
  );
  writeFileSync(
    join(TMP, "components", "Clicky.tsx"),
    `${PRAGMA}export function Clicky(props: { label: string }) {
  return <button onClick={() => console.log("hi")}>{props.label}</button>;
}
`,
  );
  writeFileSync(
    join(TMP, "components", "Shown.tsx"),
    `${PRAGMA}export function Shown(props: { label: string }) {
  return <p show="open">{props.label}</p>;
}
`,
  );
  writeFileSync(
    join(TMP, "components", "Slow.tsx"),
    `${PRAGMA}export async function Slow() {
  return <p>later</p>;
}
`,
  );
  // Draws its wrapper only when it has children, as flow-ui's Modal and Alert do.
  writeFileSync(
    join(TMP, "components", "Maybe.tsx"),
    `${PRAGMA}export function Maybe(props: { children?: unknown }) {
  return <>{props.children ? <div class="wrap">{props.children}</div> : <i>none</i>}</>;
}
`,
  );
  // Uses its text child as a value, which only the runtime hands it as a string.
  writeFileSync(
    join(TMP, "components", "Labelled.tsx"),
    `${PRAGMA}export function Labelled({ children }: { children?: unknown }) {
  return <span aria-label={children}>x</span>;
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
import { expose, locked } from "../../decorators.ts";
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
): { body?: string; blocked?: string } {
  const report: BlockerReport = {};
  const out = transformFlowFile(source, file, { report, cspSafe });
  if (!out) return { blocked: `${report.blocker?.reason ?? "?"} -> ${report.blocker?.fix ?? ""}` };
  return {
    body: `${HELPERS}${out.preamble}\nexport async function render() {\n${out.renderBody}\n}\n`,
  };
}

/** Render one page compiled and through the runtime; both HTML strings. */
async function bothWays(
  name: string,
  source: string,
): Promise<{ compiled: string; runtime: string }> {
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
  return { compiled, runtime };
}

describe("a compiled page calls the app's own function components", () => {
  it("renders a shared form, nested components and all, as the runtime does", async () => {
    const { compiled, runtime } = await bothWays(
      "CreatePage",
      page(
        "CreatePage",
        `import { ProjectForm } from "./components/ProjectForm";`,
        `<div class="page"><h1>New project</h1><ProjectForm action="/projects" values={values} submit="Create" errors={{ name: "Too short" }} /></div>`,
        `const values = { name: "Billing <beta>" };`,
      ),
    );
    expect(compiled).toBe(runtime);
    expect(compiled).toContain('value="Billing &lt;beta&gt;"');
    expect(compiled).toContain('<p class="error">Too short</p>');
    expect(compiled).toContain('class="input w-full"');
  });

  it("passes rendered children, from a default export", async () => {
    const { compiled, runtime } = await bothWays(
      "CardPage",
      page(
        "CardPage",
        `import Card from "./components/Card";`,
        `<main><Card title="Stats"><p>{count} projects</p><b>done</b></Card></main>`,
        `const count = 3;`,
      ),
    );
    expect(compiled).toBe(runtime);
    expect(compiled).toContain("<p>3 projects</p><b>done</b>");
  });

  it("calls one per row inside a .map()", async () => {
    const { compiled, runtime } = await bothWays(
      "ListPage",
      page(
        "ListPage",
        `import Card from "./components/Card";`,
        `<ul>{rows.map((row) => <li><Card title={row.name} /></li>)}</ul>`,
        `const rows = [{ name: "a" }, { name: "b & c" }];`,
      ),
    );
    expect(compiled).toBe(runtime);
    expect(compiled).toContain("b &amp; c");
  });

  it("compiles under cspSafe too", () => {
    const file = join(TMP, "CspPage.tsx");
    const source = page(
      "CspPage",
      `import { ProjectForm } from "./components/ProjectForm";`,
      `<ProjectForm action="/p" values={{ name: "" }} submit="Save" errors={{}} />`,
    );
    writeFileSync(file, source);
    expect(compile(source, file, true).body).toContain("ProjectForm(");
  });
});

describe("children and string props arrive as the runtime hands them", () => {
  it("children that render to nothing are no children", async () => {
    const { compiled, runtime } = await bothWays(
      "EmptyKids",
      page(
        "EmptyKids",
        `import { Maybe } from "./components/Maybe";`,
        `<div><Maybe>{flag && <p>error</p>}</Maybe><Maybe><b>yes</b></Maybe></div>`,
        `const flag = false;`,
      ),
    );
    expect(compiled).toBe(runtime);
    expect(compiled).toContain("<i>none</i>");
    expect(compiled).toContain('<div class="wrap"><b>yes</b></div>');
  });

  it("decodes the entities in a string prop", async () => {
    const { compiled, runtime } = await bothWays(
      "EntityProp",
      page(
        "EntityProp",
        `import Card from "./components/Card";`,
        `<Card title="A &amp; B &#39;x&#x27; &copy;" />`,
      ),
    );
    expect(compiled).toBe(runtime);
    expect(compiled).toContain("A &amp; B &#x27;x&#x27; ©");
  });
});

describe("and falls back, saying why, when it cannot", () => {
  const blocked = (name: string, imports: string, body: string, members = ""): string => {
    const file = join(TMP, `${name}.tsx`);
    const source = page(name, imports, body, "", members);
    writeFileSync(file, source);
    const out = compile(source, file);
    expect(out.body).toBeUndefined();
    return out.blocked ?? "";
  };

  it("a component holding a handler", () => {
    const why = blocked(
      "A1",
      `import { Clicky } from "./components/Clicky";`,
      `<Clicky label="x" />`,
    );
    expect(why).toContain("`<Clicky />`'s own markup does not compile");
    expect(why).toContain("Clicky.tsx:3:");
    expect(why).toContain("handler");
  });

  it("a component holding a client directive", () => {
    const why = blocked("A2", `import { Shown } from "./components/Shown";`, `<Shown label="x" />`);
    expect(why).toContain("client directive");
  });

  it("an async component", () => {
    expect(blocked("A3", `import { Slow } from "./components/Slow";`, `<Slow />`)).toContain(
      "async",
    );
  });

  it("a component from a package", () => {
    const why = blocked("A4", `import { Button } from "@zerotal/flow-ui";`, `<Button>Go</Button>`);
    expect(why).toContain("from a package (@zerotal/flow-ui)");
  });

  it("a component declared in the page's own file", () => {
    const file = join(TMP, "A5.tsx");
    const source = page("A5", "", `<Local />`).replace(
      "export class A5",
      "function Local() { return <i />; }\nexport class A5",
    );
    writeFileSync(file, source);
    expect(compile(source, file).blocked).toContain("declared in the page's own file");
  });

  it("page state bound into a component", () => {
    const why = blocked(
      "A6",
      `import { Field } from "./components/Field";`,
      `<Field name="n" label="N" value={this.name} />`,
      `@expose name = "";`,
    );
    expect(why).toContain("binds page state into a component");
  });

  it("a handler passed as a prop", () => {
    const why = blocked(
      "A7",
      `import Card from "./components/Card";`,
      `<Card title="x" onPick={() => 1} />`,
    );
    expect(why).toContain("is passed a function");
  });

  it("a component that uses its children as a value", () => {
    const why = blocked(
      "A8",
      `import { Labelled } from "./components/Labelled";`,
      `<Labelled>Close</Labelled>`,
    );
    expect(why).toContain("reads its children as a value");
    expect(why).toContain("Labelled.tsx:3:");
  });

  it("a string prop holding an entity it cannot vouch for", () => {
    const why = blocked("A9", `import Card from "./components/Card";`, `<Card title="&zwnj;x" />`);
    expect(why).toContain("holds an entity");
  });
});

describe("the modules a page's components come from", () => {
  it("are found through components that use components, relative to the page", () => {
    const file = join(TMP, "Scan.tsx");
    const source = page(
      "Scan",
      `import { ProjectForm } from "./components/ProjectForm";`,
      `<ProjectForm />`,
    );
    const found = readComponentImports(source, file).map((entry) => entry.specifier);
    expect(found).toEqual(["./components/ProjectForm.tsx", "./components/Field.tsx"]);
  });
});
