/**
 * A page that renders a function component compiles, when the compiler can read the component.
 *
 * What the compiled output does is pinned by compiled-runtime-parity.test.ts, which runs it. This
 * file pins the edges: which components are read, what stops one compiling (and that the reason
 * names the component's own file), and that what was read is recorded for the cache.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { transformFlowFile, type BlockerReport } from "./transform.ts";
import { readImportedComponents } from "./components.ts";
import { staticImportsUnchanged } from "./static-imports.ts";

const DIR = join(import.meta.dir, "__function_components__");
const PAGES = join(DIR, "pages");

beforeAll(() => mkdirSync(PAGES, { recursive: true }));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

let seq = 0;

/** Write a component module beside the pages, and a page that renders `body`. */
function setup(module: string, body: string, members = `@expose draft = "";`) {
  const n = seq++;
  writeFileSync(join(DIR, `widgets${n}.tsx`), `/** @jsxImportSource @zerotal/flow */\n${module}\n`);
  const file = join(PAGES, `page${n}.tsx`);
  const source = `/** @jsxImportSource @zerotal/flow */
import { Component, expose } from "@zerotal/flow";
import { Widget, Other } from "../widgets${n}";
export class P extends Component {
  ${members}
  override async render() {
    return (${body});
  }
}
`;
  writeFileSync(file, source);
  return { file, source, module: join(DIR, `widgets${n}.tsx`) };
}

function compile(module: string, body: string, opts: { cspSafe?: boolean } = {}) {
  const { file, source } = setup(module, body);
  const report: BlockerReport = {};
  const out = transformFlowFile(source, file, { report, ...opts });
  return { out, blocker: report.blocker };
}

const WIDGET = `export function Widget({ label }) { return <b>{label}</b>; }`;

describe("a function component the compiler can read", () => {
  it("compiles into a helper the page calls with its props", () => {
    const { out } = compile(WIDGET, `<p><Widget label="Hi" /></p>`);
    expect(out).not.toBeNull();
    expect(out!.renderBody).toContain(`__fc0({ "label": "Hi" }).html`);
    expect(out!.preamble).toContain("const __fc0 = (() => {");
  });

  it("is compiled once however often the page renders it", () => {
    const { out } = compile(WIDGET, `<p><Widget label="a" /><Widget label={"b"} /></p>`);
    expect(out!.preamble.match(/const __fc\d+ =/g)).toHaveLength(1);
  });

  it("can be an arrow, or exported from a list", () => {
    expect(
      compile(`export const Widget = ({ label }) => <b>{label}</b>;`, `<Widget label="x" />`).out,
    ).not.toBeNull();
    expect(
      compile(
        `function Local({ label }) { return <b>{label}</b>; }\nexport { Local as Widget };`,
        `<Widget label="x" />`,
      ).out,
    ).not.toBeNull();
  });

  it("can render a component of its own module", () => {
    const { out } = compile(
      `function Row({ text }) { return <li>{text}</li>; }
export function Widget({ items }) { return <ul>{items.map((i) => <Row text={i} />)}</ul>; }`,
      `<Widget items={["a", "b"]} />`,
    );
    expect(out).not.toBeNull();
    expect(out!.preamble).toContain("<Row>");
  });

  it("carries the module's own declarations it reads, and only those", () => {
    const { out } = compile(
      `const TONE = "text-red-600";
const unused = () => <i>never carried</i>;
function upper(s) { return String(s).toUpperCase(); }
export function Widget({ label }) { return <b class={TONE} title={upper(label)}>{label}</b>; }`,
      `<Widget label="x" />`,
    );
    expect(out!.preamble).toContain("function upper(s)");
    expect(out!.preamble).not.toContain("never carried");
    // The constant is folded into the markup, as a page's own would be.
    expect(out!.preamble).toContain(`class=\\"text-red-600\\"`);
  });

  it("compiles under cspSafe, where a page that does not compile is fatal", () => {
    expect(compile(WIDGET, `<Widget label="x" />`, { cspSafe: true }).out).not.toBeNull();
  });

  it("calls the helper with the page as `this` when a prop carries a binding", () => {
    const { out } = compile(
      `export function Widget({ value }) { return <input value={value} />; }`,
      `<Widget value={this.draft} />`,
    );
    expect(out!.renderBody).toContain(`__fc0.call(this, { "value": (this.draft) }).html`);
    expect(out!.preamble).toContain(`flow:model=\\"draft\\"`);
  });

  it("passes a this.x that is not a bound property as a plain value", () => {
    const { out } = compile(
      `export function Widget({ value }) { return <input value={value} />; }`,
      `<Widget value={this.plain} />`,
    );
    expect(out!.renderBody).toContain(`__fc0({ "value": (this.plain) })`);
    expect(out!.preamble).not.toContain("flow:model");
  });
});

describe("what keeps a page with a function component on the runtime", () => {
  const blocked = (module: string, body: string) => compile(module, body).blocker?.reason ?? "";

  it("a component it cannot find stays a component", () => {
    expect(blocked(WIDGET, `<Other />`)).toContain("`<Other />` is a component");
  });

  it("children", () => {
    expect(blocked(WIDGET, `<Widget label="x"><i>child</i></Widget>`)).toContain(
      "`<Widget>` is given children",
    );
  });

  it("spread props", () => {
    expect(blocked(WIDGET, `<Widget {...{ label: "x" }} />`)).toContain("spread props");
  });

  it("a function or markup passed as a prop", () => {
    expect(blocked(WIDGET, `<Widget label={() => "x"} />`)).toContain("is given a function");
    expect(blocked(WIDGET, `<Widget label={<i>x</i>} />`)).toContain("is given markup");
  });

  it("a component that reads `this`, binds a handler, or is async", () => {
    expect(blocked(`export function Widget() { return <b>{this.x}</b>; }`, `<Widget />`)).toContain(
      "reads `this`",
    );
    expect(
      blocked(
        `export function Widget() { return <button onClick={() => alert(1)}>x</button>; }`,
        `<Widget />`,
      ),
    ).toContain("binds an event handler");
    expect(blocked(`export async function Widget() { return <b />; }`, `<Widget />`)).toContain(
      "is async",
    );
  });

  it("a component the compiler cannot read, naming its own file and line", () => {
    const { file, source, module } = setup(
      `export function Widget({ ok }) {
  if (!ok) return <i />;
  return <b />;
}`,
      `<Widget ok />`,
    );
    const report: BlockerReport = {};
    expect(transformFlowFile(source, file, { report })).toBeNull();
    expect(report.blocker?.reason).toContain("`<Widget>` can't be compiled");
    expect(report.blocker?.reason).toContain("Widget() has 2 return statements");
    // Line 4 of the module: the pragma comes first.
    expect(report.blocker?.reason).toContain(`${basename(module)}:4:3`);
  });

  it("a module declaration it would have to carry that builds markup", () => {
    expect(
      blocked(
        `const icon = <svg />;\nexport function Widget() { return <b>{icon}</b>; }`,
        `<Widget />`,
      ),
    ).toContain("reads `icon`, which builds markup");
  });
});

describe("what the cache is told about", () => {
  it("records the component's module and what it reads constants from, from the page", () => {
    const ui = join(DIR, "styles.ts");
    writeFileSync(ui, `export const CARD = "p-4";\n`);
    const { file, source, module } = setup(
      `import { CARD } from "./styles";\nexport function Widget() { return <b class={CARD} />; }`,
      `<Widget />`,
    );
    const found = readImportedComponents(source, file);
    expect([...found.components.keys()]).toEqual(["Widget"]);
    expect(found.fingerprint).not.toBe("");
    expect(found.imports.map((i) => i.file).sort()).toEqual([ui, module].sort());
    // Each is re-expressed as an import from the page, which is how the manifest checks it.
    expect(staticImportsUnchanged(file, found.imports)).toBe(true);

    writeFileSync(ui, `export const CARD = "p-8";\n`);
    expect(staticImportsUnchanged(file, found.imports)).toBe(false);
    expect(readImportedComponents(source, file).fingerprint).not.toBe(found.fingerprint);
  });

  it("does not read a component the page uses only outside render(), such as its layout", () => {
    const { file, source } = setup(WIDGET, `<p>no components here</p>`);
    const withLayout = source.replace(
      "  override async render() {",
      "  override layout(page) {\n    return <Widget label={page} />;\n  }\n  override async render() {",
    );
    expect(withLayout).toContain("override layout(page)");
    const found = readImportedComponents(withLayout, file);
    expect(found.components.size).toBe(0);
    expect(found.fingerprint).toBe("");
  });

  it("finds nothing, and adds nothing to the key, for a page without components", () => {
    const found = readImportedComponents(
      `export class P { render() { return <div />; } }`,
      join(PAGES, "none.tsx"),
    );
    expect(found).toEqual({ components: new Map(), imports: [], fingerprint: "" });
  });
});
