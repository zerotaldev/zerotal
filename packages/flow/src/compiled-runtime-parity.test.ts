/**
 * The compiled and runtime render paths must agree on bindings.
 *
 * Flow renders a page one of two ways. The AOT compiler reads the binding intent
 * out of the AST; when it bails (a branching `render()`, a component child, a
 * loop-local value — 24 documented blockers) the page falls back to the runtime
 * renderer, which infers the same bindings by observing property reads during
 * render. That second path is necessarily weaker, and the gap between them is
 * where the field reports kept finding silent failures: an element that carried
 * `flow:model` when compiled and nothing when not (B2), or a model name that
 * landed on the wrong element (B39).
 *
 * "Necessarily weaker" is a statement about mechanism, not about output. This
 * suite pins the output: for every shape the compiler accepts, both paths must
 * emit the same `flow:*` bindings. A divergence is a bug in whichever path is
 * wrong, and it fails here naming the shape.
 *
 * Each case is written once and driven through both paths — the source text is
 * compiled *and* imported as a real class — so the two can never drift apart in
 * the fixture itself, which is the failure mode a hand-written pair would have.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transformFlowFile, type BlockerReport } from "./compiler/transform.ts";
import { FlowTest } from "./testing.ts";
import type { Component } from "./Component.ts";

const TMP = join(import.meta.dir, "__parity__");

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** One shape, expressed once, driven through both paths. */
interface ParityCase {
  name: string;
  /** Class members — decorated props the body binds to. */
  members: string;
  /** The JSX `render()` returns. */
  body: string;
}

/**
 * Every binding directive in a rendered document, sorted.
 *
 * Two forms count as a binding, and a page can emit either: Flow's own
 * `flow:model="x"` family, and the Alpine reactive form `:value="$flow.x"` that
 * a `@locked` (read-only) property renders as.
 *
 * Deliberately *not* compared: plain attributes like `value="ABC-1"`. The
 * compiled path is a template with `${…}` holes where the runtime path has the
 * evaluated value, so those differ by construction rather than by behaviour.
 * The binding directives are static text in both, which is what makes them the
 * honest basis for comparison — and they are the thing the field reports found
 * going missing.
 */
function flowAttrs(markup: string): string[] {
  const unescaped = markup.split(String.fromCharCode(92)).join("");
  const directives = unescaped.match(/flow:[a-z.:-]+="[^"]*"/g) ?? [];
  const reactive = unescaped.match(/:[a-z-]+="\$flow\.[^"]*"/g) ?? [];
  return [...directives, ...reactive].sort();
}

function sourceFor(c: ParityCase): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component } from "../Component.ts";
import { expose, locked } from "../decorators.ts";

export class ParityPage extends Component {
  ${c.members}
  override async render() {
    return (${c.body});
  }
}
`;
}

/** Compile the source; returns its bindings, or the blocker that stopped it. */
function compiledAttrs(source: string, file: string): { attrs?: string[]; blocked?: string } {
  const report: BlockerReport = {};
  const out = transformFlowFile(source, file, { report });
  if (!out) return { blocked: report.blocker?.reason ?? "no render body" };
  return { attrs: flowAttrs(out.renderBody) };
}

/** Import the very same file and render it through the runtime path. */
async function runtimeAttrs(path: string): Promise<string[]> {
  const mod = (await import(path)) as { ParityPage: new () => Component };
  const t = await FlowTest.mount(mod.ParityPage);
  return flowAttrs(t.html());
}

// ── The corpus ───────────────────────────────────────────────────────────────
// Weighted towards the binding surface, because that is where both field-report
// rounds found silent failures.

const CASES: ParityCase[] = [
  {
    name: "a plain value binding",
    members: `@expose draft = "";`,
    body: `<input value={this.draft} />`,
  },
  {
    name: "a live value binding",
    members: `@expose draft = "";`,
    body: `<input value={this.draft} live />`,
  },
  {
    name: "a blur value binding",
    members: `@expose draft = "";`,
    body: `<input value={this.draft} blur />`,
  },
  {
    name: "a checkbox bound with checked",
    members: `@expose agreed = false;`,
    body: `<input type="checkbox" checked={this.agreed} />`,
  },
  {
    // B2: a reactive sibling attribute once left the element with no binding at
    // all — the field accepted typing and nothing reached the server.
    name: "a value binding beside a reactive disabled",
    members: `@expose destination = ""; @expose notSure = false;`,
    body: `<input value={this.destination} disabled={this.notSure} />`,
  },
  {
    name: "two bound inputs in one document",
    members: `@expose first = ""; @expose second = "";`,
    body: `<div><input value={this.first} /><input value={this.second} /></div>`,
  },
  {
    // B39: a getter supplying children must not cost the element its binding,
    // nor hand the model name to the next element.
    name: "a select whose children come from a getter",
    members: `@expose town = "Durban";
  private get towns() { return ["Durban", "Umhlanga"]; }`,
    body: `<select value={this.town} live>{this.towns.map((t) => <option>{t}</option>)}</select>`,
  },
  {
    name: "a locked value rendered read-only",
    members: `@locked reference = "ABC-1";`,
    body: `<input value={this.reference} />`,
  },
  {
    name: "a show binding",
    members: `@expose open = true;`,
    body: `<div show={this.open}>panel</div>`,
  },
  {
    name: "a bound input inside a wrapper",
    members: `@expose email = "";`,
    body: `<form><fieldset><input value={this.email} live /></fieldset></form>`,
  },
];

describe("compiled and runtime paths agree on bindings", () => {
  for (const [i, c] of CASES.entries()) {
    it(c.name, async () => {
      const file = join(TMP, `case${i}.tsx`);
      const source = sourceFor(c);
      writeFileSync(file, source);

      const compiled = compiledAttrs(source, file);
      const runtime = await runtimeAttrs(file);

      if (compiled.blocked) {
        // A bail is legitimate (24 documented blockers). What is never
        // acceptable is the fallback then losing the binding, so the runtime
        // path still has to carry it.
        expect(runtime.length).toBeGreaterThan(0);
        return;
      }
      // Guard against a vacuous pass: two empty sets are trivially equal, which
      // would make this suite green while proving nothing. Every case in the
      // corpus binds something, so an empty compiled set is itself the bug.
      expect(compiled.attrs!.length).toBeGreaterThan(0);
      expect(runtime).toEqual(compiled.attrs!);
    });
  }
});

describe("the fallback still binds what the compiler would have", () => {
  // Shapes the compiler is documented to bail on. Each one used to be a way to
  // lose a binding silently; the runtime path must carry it regardless.
  const FALLBACK_CASES: ParityCase[] = [
    {
      name: "a branching render()",
      members: `@expose draft = ""; @expose ready = false;`,
      body: `this.ready ? <input value={this.draft} /> : <input value={this.draft} />`,
    },
    {
      name: "a loop-local value in the same document as a binding",
      members: `@expose town = ""; private get towns() { return ["a", "b"]; }`,
      body: `<div><input value={this.town} live />{this.towns.map((t) => <span>{t}</span>)}</div>`,
    },
  ];

  for (const [i, c] of FALLBACK_CASES.entries()) {
    it(c.name, async () => {
      const file = join(TMP, `fallback${i}.tsx`);
      writeFileSync(file, sourceFor(c));
      const runtime = await runtimeAttrs(file);
      expect(runtime.some((a) => a.startsWith("flow:model"))).toBe(true);
    });
  }
});

// ── Function components ──────────────────────────────────────────────────────
// A page that renders a function component used to fall back to the runtime. It now compiles,
// with the component's body compiled into a helper the page calls. The bindings are not the only
// thing that can drift there: the props, the escaping and the attribute rules all pass through a
// second function. So these cases compare the whole document, rendered by running the compiled
// module itself against the very same page.

/** One page and the component module it imports, rendered both ways. */
interface ComponentCase extends ParityCase {
  /** The component module, written beside the page as `./widgets<i>.tsx`. */
  module: string;
  /** Names the page imports from it. */
  imports: string[];
}

const COMPONENT_CASES: ComponentCase[] = [
  {
    name: "a component given only literal props",
    imports: ["Badge"],
    module: `export function Badge({ label, tone }) {
  return <span class={"badge badge-" + tone} data-tone={tone}>{label}</span>;
}`,
    members: `@expose open = false;`,
    body: `<p show={this.open}><Badge label="New & shiny" tone="info" /></p>`,
  },
  {
    name: "a component whose input is bound to this.x, destructured",
    imports: ["TextInput"],
    module: `export function TextInput({ value, label }) {
  return (
    <label class="field">
      {label}
      <input class="input" value={value} />
    </label>
  );
}`,
    members: `@expose draft = "hello";`,
    body: `<form><TextInput label="Draft" value={this.draft} /></form>`,
  },
  {
    name: "a component whose input is bound to this.x, through props",
    imports: ["Field"],
    module: `export const Field = (props) => (
  <div class="field">
    <label for={props.id}>{props.label}</label>
    <input id={props.id} value={props.value} live />
    <p data-error-for={props.id} hidden={!props.error}>{props.error}</p>
  </div>
);`,
    members: `@expose email = "a@b.c";`,
    body: `<form><Field id="email" label="Email" value={this.email} error="Required" /></form>`,
  },
  {
    name: "a component bound to a checkbox and a locked value",
    imports: ["Toggle", "Readout"],
    module: `export function Toggle({ on, children }) {
  return <input type="checkbox" checked={on} />;
}
export function Readout({ value }) {
  return <input value={value} />;
}`,
    // Unchecked on purpose: a compiled page does not write `checked` for a bound checkbox that
    // starts on (the bridge sets it), where the runtime does. That is the page compiler's rule,
    // the same with or without a component, and not what this suite is about.
    members: `@expose agreed = false; @locked reference = "ABC-1";`,
    body: `<div><Toggle on={this.agreed} /><Readout value={this.reference} /></div>`,
  },
  {
    name: "the starter's form: server values, errors and a list of options",
    imports: ["ProjectForm"],
    module: `const OPTIONS = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active <now>" },
];
const FIELD = "space-y-1.5";
const BUTTON = FIELD + " btn";
export function ProjectForm({ action, method, values, errors, submit }) {
  return (
    <form method="post" action={action} data-method={method}>
      <div class={FIELD}>
        <input name="name" value={values.name} required aria-invalid={errors.name ? "true" : undefined} />
        <p data-error-for="name" hidden={!errors.name}>{errors.name}</p>
      </div>
      <textarea name="description" rows="4">{values.description}</textarea>
      <select name="status">
        {OPTIONS.map((option) => (
          <option value={option.value} selected={option.value === values.status}>
            {option.label}
          </option>
        ))}
      </select>
      <button type="submit" class={BUTTON}>{submit}</button>
    </form>
  );
}`,
    members: `@expose open = false; protected errorFor(field: string): string | undefined {
    return field === "name" ? "The name is <required>." : undefined;
  }`,
    body: `<div show={this.open}>
      <ProjectForm
        action={"/projects/" + 7}
        method="put"
        values={{ name: "Q4 \\"plan\\"", description: "a < b & c", status: "active" }}
        errors={{ name: this.errorFor("name"), description: this.errorFor("description") }}
        submit="Save changes"
      />
    </div>`,
  },
  {
    name: "a component that renders another, passing the binding through",
    imports: ["Panel"],
    module: `import { Row } from "./widgets-row.tsx";
export function Panel({ title, value }) {
  return (
    <section>
      <h2>{title}</h2>
      <Row label="Town" value={value} />
    </section>
  );
}`,
    members: `@expose town = "Durban";`,
    body: `<div><Panel title="Where" value={this.town} /></div>`,
  },
];

/** The nested component of the last case. */
const ROW_MODULE = `/** @jsxImportSource @zerotal/flow */
export function Row({ label, value }) {
  return <p class="row">{label}: <input value={value} live /></p>;
}
`;

/**
 * `markup` with each tag's attributes in name order. The two paths write some attributes in a
 * different order (`:value … readonly value` against `:value … value readonly`), which the
 * browser does not see; everything else, values and escaping included, has to match exactly.
 */
function sortedAttributes(markup: string): string {
  return markup.replace(
    /<([a-z][a-z0-9-]*)((?:\s+[^\s=>"]+(?:="[^"]*")?)*)\s*>/g,
    (_tag, name: string, attrs: string) => {
      const list = attrs.match(/[^\s=>"]+(?:="[^"]*")?/g) ?? [];
      return `<${name}${list.length ? " " + list.sort().join(" ") : ""}>`;
    },
  );
}

function componentSourceFor(c: ComponentCase, i: number): string {
  return sourceFor(c).replace(
    `import { expose, locked } from "../decorators.ts";`,
    `import { expose, locked } from "../decorators.ts";\nimport { ${c.imports.join(", ")} } from "./widgets${i}.tsx";`,
  );
}

describe("a page that renders a function component compiles, and renders what the runtime does", () => {
  for (const [i, c] of COMPONENT_CASES.entries()) {
    it(c.name, async () => {
      writeFileSync(join(TMP, "widgets-row.tsx"), ROW_MODULE);
      writeFileSync(
        join(TMP, `widgets${i}.tsx`),
        `/** @jsxImportSource @zerotal/flow */\n${c.module}\n`,
      );
      const file = join(TMP, `component${i}.tsx`);
      const source = componentSourceFor(c, i);
      writeFileSync(file, source);

      const report: BlockerReport = {};
      const out = transformFlowFile(source, file, { report });
      // The point of the change: the page compiles, and the component is a compiled helper.
      expect(report.blocker?.reason).toBeUndefined();
      expect(out).not.toBeNull();
      expect(out!.renderBody).toMatch(/__fc\d+(\.call\(this, |\()\{/);
      expect(out!.renderBody).not.toContain("jsx(");

      const mod = (await import(file)) as {
        ParityPage: (new () => Component) & { __flowCompiled?: boolean };
      };
      const runtime = (await FlowTest.mount(mod.ParityPage)).html();

      // Run the compiled module, as the boot would: helpers, the page's scope, then render().
      const compiledFile = join(TMP, `component${i}.compiled.ts`);
      writeFileSync(
        compiledFile,
        `import { __esc, __escAttr, __attr } from ${JSON.stringify(join(import.meta.dir, "compiler", "helpers.ts"))};\n` +
          `${out!.preamble}\n\nexport async function render() {\n${out!.renderBody}\n}\n`,
      );
      const compiledModule = (await import(compiledFile)) as {
        render: Component["render"];
      };
      mod.ParityPage.prototype.render = compiledModule.render;
      mod.ParityPage.__flowCompiled = true;
      const compiled = (await FlowTest.mount(mod.ParityPage)).html();

      expect(sortedAttributes(compiled)).toBe(sortedAttributes(runtime));
      // And the bindings in it are the ones the runtime found, which is what the first suite
      // checks for pages without components.
      expect(flowAttrs(compiled)).toEqual(flowAttrs(runtime));
    });
  }
});
