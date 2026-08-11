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
