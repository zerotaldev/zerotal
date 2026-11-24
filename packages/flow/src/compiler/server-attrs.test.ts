import { describe, it, expect } from "bun:test";
import { transformFlowFile, type BlockerReport } from "./transform.ts";
import { __attr, __esc, __escAttr } from "./helpers.ts";

/**
 * An attribute whose value is worked out on the server — `href={route("login")}`,
 * `data-id={row.id}` inside a `.map()`, `aria-invalid={error ? "true" : undefined}` — compiles
 * to that value, written the way the runtime renderer writes it. It used to force the whole page
 * onto the runtime, and under `cspSafe` to fail it outright, although it needs no client code.
 */

function page(body: string, lead = "", top = ""): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component, expose } from '@zerotal/flow';
${top}
export class DemoPage extends Component {
  @expose search = "";
  override async render() { ${lead} return (${body}); }
}`;
}

const FILE = "/app/flow/pages/demo.tsx";

/** Compile, then run the compiled render() against `self`, with `scope` as its module scope. */
async function render(
  body: string,
  opts: { lead?: string; top?: string; scope?: Record<string, unknown>; self?: object } = {},
): Promise<string> {
  const result = transformFlowFile(page(body, opts.lead, opts.top), FILE, { cspSafe: true });
  if (!result) throw new Error("did not compile");
  const scope = { __esc, __escAttr, __attr, ...opts.scope };
  const fn = new Function(
    ...Object.keys(scope),
    `return async function render() {\n${result.renderBody}\n};`,
  )(...Object.values(scope)) as () => Promise<{ html: string }>;
  return (await fn.call(opts.self ?? { search: "" })).html;
}

describe("__attr", () => {
  it("writes the name and the quoted, escaped value", () => {
    expect(__attr("title", `a "b" <c> & d`)).toBe(' title="a &quot;b&quot; &lt;c&gt; &amp; d"');
  });

  it("writes true as the bare name, and drops false and nullish", () => {
    expect(__attr("hidden", true)).toBe(" hidden");
    expect(__attr("hidden", false)).toBe("");
    expect(__attr("hidden", null)).toBe("");
    expect(__attr("hidden", undefined)).toBe("");
  });

  it("writes numbers and zero", () => {
    expect(__attr("data-count", 0)).toBe(' data-count="0"');
  });

  it("checks the scheme of a URL attribute, as the runtime does", () => {
    expect(__attr("href", "javascript:alert(1)")).toBe(' href="about:blank"');
    expect(__attr("href", "/projects/1/edit")).toBe(' href="/projects/1/edit"');
  });
});

describe("Flow compiler — attributes worked out on the server", () => {
  it("compiles a call, under cspSafe", async () => {
    const html = await render(`<a href={route("login")}>x</a>`, {
      scope: { route: (name: string) => `/${name}` },
    });
    expect(html).toBe('<a href="/login">x</a>');
  });

  it("gives each row of a .map() its own value", async () => {
    const html = await render(
      `<ul>{rows.map((row) => <li key={row.id} data-id={row.id} class={row.done ? "done" : "open"}>{row.name}</li>)}</ul>`,
      {
        lead: `const rows = [{ id: 1, name: "a", done: true }, { id: 2, name: "b", done: false }];`,
      },
    );
    expect(html).toBe(
      '<ul><li data-id="1" class="done">a</li><li data-id="2" class="open">b</li></ul>',
    );
  });

  it("writes a boolean the way the runtime does", async () => {
    const html = await render(`<p><input checked={on} /><input checked={off} /></p>`, {
      lead: "const on = true; const off = false;",
    });
    expect(html).toBe("<p><input checked><input></p>");
  });

  it("renames JSX attribute names", async () => {
    const html = await render(`<label htmlFor={id}>x</label>`, { lead: `const id = "email";` });
    expect(html).toBe('<label for="email">x</label>');
  });

  it("writes a numeric literal as written", async () => {
    expect(await render(`<textarea rows={3}></textarea>`)).toBe('<textarea rows="3"></textarea>');
  });

  it("keeps a bound input two-way, beside a server-worked value", () => {
    const result = transformFlowFile(
      page(`<input value={this.search} aria-label={label} />`, `const label = "Search";`),
      FILE,
    );
    const out = result!.renderBody.replace(/\\/g, "");
    expect(out).toContain('flow:model="search"');
    expect(out).toContain('__attr("aria-label", label)');
  });

  it("still leaves an unreadable imported class list to the runtime", () => {
    const report: BlockerReport = {};
    const result = transformFlowFile(
      page(`<div class={CARD}>x</div>`, "", `import { CARD } from "./ui.ts";`),
      FILE,
      { report },
    );
    expect(result).toBeNull();
    expect(report.blocker?.reason).toContain("is not a static class string");
  });
});

describe("Flow compiler — dangerouslySetInnerHTML", () => {
  it("writes the markup unescaped in place of the children, as the runtime does", async () => {
    const html = await render(`<svg class="size-4" dangerouslySetInnerHTML={{ __html: body }} />`, {
      lead: `const body = '<path d="M1 1"/>';`,
    });
    expect(html).toBe('<svg class="size-4"><path d="M1 1"/></svg>');
  });

  it("writes nothing for a missing body", async () => {
    expect(
      await render(`<div dangerouslySetInnerHTML={{ __html: none }}></div>`, {
        lead: "const none = undefined;",
      }),
    ).toBe("<div></div>");
  });

  it("falls back for any other shape", () => {
    const report: BlockerReport = {};
    transformFlowFile(page(`<div dangerouslySetInnerHTML={{ html: "x" }}></div>`), FILE, {
      report,
    });
    expect(report.blocker?.reason).toContain("is not `{{ __html: … }}`");
  });
});
