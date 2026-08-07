import { describe, it, expect } from "bun:test";
import { transformFlowFile, buildBindInjectedRender, type BlockerReport } from "./transform.ts";

/** Wrap a render() return-body in a minimal Component page with the given members. */
function page(body: string, members = '@locked title = "";'): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component, expose, locked, computed } from '@zerotal/flow';
import { fmt } from '../helpers/fmt.ts';
const SUFFIX = '!';
export class DemoPage extends Component {
  ${members}
  override async render() { return (${body}); }
}`;
}

function compile(body: string, members?: string) {
  return transformFlowFile(page(body, members), "/app/flow/pages/demo.tsx");
}

/** renderBody is JS source, so emitted HTML has JSON-escaped quotes; strip backslashes to assert on the HTML. */
const html = (r: { renderBody: string } | null) => (r ? r.renderBody.replace(/\\/g, "") : "");

describe("Flow compiler — <ErrorMessage>", () => {
  it("compiles for={this.field} to a reactive error span", () => {
    const r = compile(
      `<ErrorMessage for={this.email} class="text-xs text-rose-400" />`,
      '@expose email = "";',
    );
    expect(r).not.toBeNull();
    expect(html(r)).toContain('<span flow:error="email" flow:show="errors.email"');
    expect(html(r)).toContain('class="text-xs text-rose-400"');
  });

  it("accepts for={this.errors.field} and the legacy name=", () => {
    expect(
      html(compile(`<ErrorMessage for={this.errors.email} />`, '@expose email = "";')),
    ).toContain('flow:error="email"');
    expect(
      html(compile(`<ErrorMessage name={this.errors.email} />`, '@expose email = "";')),
    ).toContain('flow:error="email"');
  });

  it("uses the default class when none is given", () => {
    expect(html(compile(`<ErrorMessage for={this.email} />`, '@expose email = "";'))).toContain(
      'class="text-red-400 text-xs"',
    );
  });

  it("rejects an unknown field", () => {
    expect(() => compile(`<ErrorMessage for={this.nope} />`, '@expose email = "";')).toThrow();
  });
});

describe("Flow compiler — form submit", () => {
  it("compiles onSubmit={this.method} to flow:submit", () => {
    const r = compile(`<form onSubmit={this.save}><button>Go</button></form>`, "@expose save() {}");
    expect(html(r)).toContain('flow:submit="save"');
  });

  it("compiles the bare submit={this.method} shorthand to flow:submit", () => {
    const r = compile(
      `<form submit={this.submit}><button>Go</button></form>`,
      "@expose submit() {}",
    );
    expect(html(r)).toContain('flow:submit="submit"');
    expect(html(r)).not.toContain("async submit"); // must NOT stringify the method body
  });
});

describe("Flow compiler — E (recursive emitter + scope preservation)", () => {
  it("compiles a plain element with a this-prop child", () => {
    const r = compile(`<div><h1>{this.title}</h1></div>`);
    expect(r).not.toBeNull();
    expect(r!.renderBody).toContain("<h1>");
    expect(r!.renderBody).toContain("__esc(this.title)");
  });

  it("preserves module scope: rewrites relative imports to file URLs, keeps package imports, carries consts", () => {
    const r = compile(`<div>{this.title}</div>`);
    expect(r!.preamble).toContain("@zerotal/flow"); // package import kept
    expect(r!.preamble).toMatch(/import \{ fmt \} from "file:\/\//); // relative → absolute file URL
    expect(r!.preamble).toContain("const SUFFIX = '!';"); // top-level const carried
  });

  it("compiles a ternary in child position", () => {
    const r = compile(
      `<div>{this.open ? <span>a</span> : <b>c</b>}</div>`,
      '@locked title=""; @expose open = false;',
    );
    expect(r).not.toBeNull();
    expect(r!.renderBody).toContain("this.open ?");
    expect(r!.renderBody).toContain("<span>a</span>");
    expect(r!.renderBody).toContain("<b>c</b>");
  });

  it("compiles logical-and", () => {
    const r = compile(
      `<div>{this.open && <i>hi</i>}</div>`,
      '@locked title=""; @expose open = false;',
    );
    expect(r).not.toBeNull();
    expect(r!.renderBody).toContain("this.open ?");
    expect(r!.renderBody).toContain("<i>hi</i>");
    expect(r!.renderBody).toContain('"")');
  });

  it("compiles .map with a concise JSX body", () => {
    const r = compile(
      `<ul>{this.rows.map((it) => <li>{it.n}</li>)}</ul>`,
      '@locked title=""; @expose rows = [];',
    );
    expect(r).not.toBeNull();
    expect(r!.renderBody).toContain("this.rows.map((it) =>");
    expect(r!.renderBody).toContain("__esc(it.n)");
    expect(r!.renderBody).toContain('.join("")');
  });

  it("carries leading statements before the return", () => {
    const src = `/** @jsxImportSource @zerotal/flow */
import { Component, locked } from '@zerotal/flow';
export class DemoPage extends Component {
  @locked title = "";
  override async render() { const count = 5; return (<p>{count}</p>); }
}`;
    const r = transformFlowFile(src, "/app/flow/pages/demo.tsx");
    expect(r).not.toBeNull();
    expect(r!.renderBody).toContain("const count = 5;");
    expect(r!.renderBody).toContain("__esc(count)");
  });

  it("bails (→ runtime) on multiple returns / branching", () => {
    const src = `/** @jsxImportSource @zerotal/flow */
import { Component, locked } from '@zerotal/flow';
export class DemoPage extends Component {
  @locked title = "";
  override async render() { if (!this.title) return (<i>none</i>); return (<p>{this.title}</p>); }
}`;
    expect(transformFlowFile(src, "/app/flow/pages/demo.tsx")).toBeNull();
  });
});

describe("Flow compiler — input/error bindings", () => {
  it("value={this.x} on @expose → two-way flow:model", () => {
    const r = compile(`<input value={this.draft} />`, '@locked title=""; @expose draft = "";');
    expect(html(r)).toContain('flow:model="draft"');
  });

  it("value={this.x} live → flow:model.live", () => {
    const r = compile(`<input value={this.draft} live />`, '@locked title=""; @expose draft = "";');
    expect(html(r)).toContain('flow:model.live="draft"');
  });

  it("value={this.x} on @locked → reactive read-only", () => {
    const r = compile(`<input value={this.code} />`, '@locked title=""; @locked code = "";');
    expect(html(r)).toContain(':value="$flow.code"');
    expect(html(r)).toContain("readonly");
  });

  it("checked={this.x} on @expose → flow:model", () => {
    const r = compile(
      `<input type="checkbox" checked={this.done} />`,
      '@locked title=""; @expose done = false;',
    );
    expect(html(r)).toContain('flow:model="done"');
  });

  it("error={this.errors.field} → flow:error + flow:show", () => {
    const r = compile(`<span error={this.errors.title} />`);
    expect(html(r)).toContain('flow:error="title"');
    expect(html(r)).toContain('flow:show="errors.title"');
  });

  it("value={this.form.field} → nested flow:model (Form binding)", () => {
    const r = compile(
      `<input value={this.form.email} />`,
      '@locked title = ""; @expose form = {};',
    );
    expect(html(r)).toContain('flow:model="form.email"');
  });
});

describe("Flow compiler — G: client-reactive class", () => {
  it("decomposes a snapshot-only template class into static class + Alpine :class", () => {
    const r = compile(
      "<div className={`bg-all ${this.count > 5 ? 'high' : 'low'}`}>x</div>",
      '@locked title=""; @expose count = 0;',
    );
    expect(r).not.toBeNull();
    expect(html(r)).toContain('class="bg-all"');
    expect(html(r)).toContain(":class=\"[$flow.count > 5 ? 'high' : 'low']\"");
  });

  it("keeps static prefix and emits multiple dynamic parts", () => {
    const r = compile(
      "<div className={`box ${this.a} mid ${this.b}`}>x</div>",
      '@locked title=""; @expose a=""; @expose b="";',
    );
    expect(html(r)).toContain('class="box mid"');
    expect(html(r)).toContain(':class="[$flow.a, $flow.b]"');
  });

  it("bails (→ runtime) when the class expression calls a method (not snapshot-only)", () => {
    const r = compile("<div className={`x ${this.title.toUpperCase()}`}>y</div>");
    expect(r).toBeNull();
  });

  it("bails when the class references a non-snapshot local", () => {
    const r = compile("<div className={`x ${cls}`}>y</div>");
    expect(r).toBeNull();
  });
});

describe("Flow compiler — handlers (no flow wrapper)", () => {
  it("onClick={this.method} → server action", () => {
    const r = compile(
      `<button onClick={this.save}>x</button>`,
      '@locked title=""; save = () => {};',
    );
    expect(html(r)).toContain('flow:click="save"');
  });

  it("onClick={() => this.x = 0} → client expression ($flow)", () => {
    const r = compile(
      `<button onClick={() => this.open = false}>x</button>`,
      '@locked title=""; @expose open = true;',
    );
    expect(html(r)).toContain('flow:click="');
    expect(html(r)).toContain("$flow.open = false");
  });
});

describe("Flow compiler — client-magic URL bindings", () => {
  it("href={this.currentUrl({ query: this.q, hash: this.hash })} → reactive :href", () => {
    const r = compile(
      `<link href={this.currentUrl({ query: this.q, hash: this.hash })} />`,
      '@expose q = ""; @expose hash = "";',
    );
    expect(r).not.toBeNull();
    expect(html(r)).toContain(':href="$flow.currentUrl({ query: $flow.q, hash: $flow.hash })"');
  });

  it("accepts a literal query object (no this refs)", () => {
    const r = compile(`<a href={this.currentUrl({ query: { page: 2 } })}>next</a>`);
    expect(html(r)).toContain(':href="$flow.currentUrl({ query: { page: 2 } })"');
  });

  it("renames the attribute (htmlFor → for) on the reactive binding", () => {
    const r = compile(`<label htmlFor={this.currentUrl({ hash: 'x' })}>l</label>`);
    expect(html(r)).toContain(":for=\"$flow.currentUrl({ hash: 'x' })\"");
  });

  it("rewrites a magic nested in a larger attribute expression (class ternary)", () => {
    const r = compile(
      `<a class={this.currentUrl() === "/" ? "on" : ""}>x</a>`,
      '@locked title = "";',
    );
    expect(html(r)).toContain(
      `:class="$flow.currentUrl() === &quot;/&quot; ? &quot;on&quot; : &quot;&quot;"`,
    );
  });

  it("supports a text child → reactive flow:text span", () => {
    const r = compile(`<div>{this.currentUrl({ query: { tab: 'a' } })}</div>`);
    expect(html(r)).toContain(
      `<span flow:text="$flow.currentUrl({ query: { tab: 'a' } })"></span>`,
    );
  });

  it("supports a magic in a text-child ternary → reactive flow:text span", () => {
    const r = compile(`<div>{this.currentUrl() === "/" ? "Home" : "Away"}</div>`);
    expect(html(r)).toContain(
      `flow:text="$flow.currentUrl() === &quot;/&quot; ? &quot;Home&quot; : &quot;Away&quot;"`,
    );
  });

  it("rejects an args this-prop that is not @expose/@locked", () => {
    expect(() =>
      compile(`<link href={this.currentUrl({ query: this.nope })} />`, '@expose q = "";'),
    ).toThrow();
  });

  it("rejects a client magic in a server-evaluated position (&& condition gating JSX)", () => {
    expect(() =>
      compile(`<div>{this.currentUrl() === "/" && <span>home</span>}</div>`, '@locked title = "";'),
    ).toThrow();
  });

  it("does not treat a normal this.prop as a magic binding", () => {
    // this.url is a normal readable prop → server-rendered value, not :href.
    const r = compile(`<a href={this.url}>x</a>`, '@locked url = "";');
    expect(html(r)).not.toContain(":href=");
    expect(html(r)).toContain('href="');
  });
});

describe("Flow compiler — <Link>", () => {
  it("compiles <Link href hover> to <a flow:navigate flow:navigate.hover>", () => {
    const r = compile(`<Link href="/about" hover class="x">Learn more</Link>`);
    expect(r).not.toBeNull();
    expect(html(r)).toContain("<a flow:navigate");
    expect(html(r)).toContain('href="/about"');
    expect(html(r)).toContain("flow:navigate.hover");
    expect(html(r)).toContain('class="x"');
    expect(html(r)).toContain("Learn more</a>");
  });

  it("translates current={false} to flow:current.ignore", () => {
    const r = compile(`<Link href="/" current={false}>Home</Link>`);
    expect(html(r)).toContain("flow:current.ignore");
    expect(html(r)).not.toContain("current={false}");
  });

  it("supports a client magic in the Link href (page no longer bails)", () => {
    const r = compile(
      `<Link href={this.currentUrl({ query: this.q })}>Self</Link>`,
      '@expose q = "";',
    );
    expect(r).not.toBeNull();
    expect(html(r)).toContain('<a flow:navigate :href="$flow.currentUrl({ query: $flow.q })"');
  });

  it("compiles a self-closing <Link /> to an empty anchor", () => {
    const r = compile(`<Link href="/x" />`);
    expect(html(r)).toContain('<a flow:navigate href="/x"></a>');
  });
});

describe("Flow compiler — runtime-backed directives (map parity with PULSE_PROP_MAP)", () => {
  it("transition → flow:transition (enter animation on morph)", () => {
    const r = compile(`<div transition>fresh</div>`);
    expect(html(r)).toContain("<div flow:transition>");
    expect(html(r)).not.toContain(" transition>"); // not the raw prop name
  });

  it("showOnOffline / hideOnOffline → flow:offline family", () => {
    expect(html(compile(`<div showOnOffline>Offline</div>`))).toContain("<div flow:offline>");
    expect(html(compile(`<div hideOnOffline>Online</div>`))).toContain("<div flow:offline.remove>");
  });

  it("offlineClass / offlineAttr → flow:offline.class / flow:offline.attr", () => {
    expect(html(compile(`<div offlineClass="opacity-50">x</div>`))).toContain(
      'flow:offline.class="opacity-50"',
    );
    expect(html(compile(`<button offlineAttr="disabled">x</button>`))).toContain(
      'flow:offline.attr="disabled"',
    );
  });

  it("loadingTarget / loadingTargetExcept → flow:target scoping", () => {
    expect(
      html(compile(`<div showOnLoading loadingTarget="save">…</div>`, "@expose save() {}")),
    ).toContain('flow:target="save"');
    expect(
      html(compile(`<div showOnLoading loadingTargetExcept="poll">…</div>`, "@expose poll() {}")),
    ).toContain('flow:target.except="poll"');
  });

  it("onSort={this.method} + sortItem → flow:sort container + flow:sort:item key", () => {
    const r = compile(
      `<ul onSort={this.reorder}><li sortItem="a">A</li></ul>`,
      "@locked title=''; @expose reorder() {}",
    );
    expect(html(r)).toContain('flow:sort="reorder"');
    expect(html(r)).toContain('flow:sort:item="a"');
  });

  it("sortHandle / sortIgnore → flow:sort:handle / flow:sort:ignore", () => {
    expect(html(compile(`<span sortHandle>⠿</span>`))).toContain("<span flow:sort:handle>");
    expect(html(compile(`<li sortIgnore>pinned</li>`))).toContain("<li flow:sort:ignore>");
  });

  it("showOnError / hideOnError → flow:failed (optimistic failed state)", () => {
    expect(html(compile(`<div showOnError>Couldn't save</div>`))).toContain("<div flow:failed>");
    expect(html(compile(`<div hideOnError>Saved</div>`))).toContain("<div flow:failed.remove>");
  });
});

describe("Flow compiler — bind-name injection", () => {
  function inject(body: string, members: string): string | null {
    const src = `/** @jsxImportSource @zerotal/flow */
import { Component, expose } from '@zerotal/flow';
import { Sheet, Checkbox, Combobox } from '@zerotal/flow-ui';
export class DemoPage extends Component {
  ${members}
  override async render() { return (${body}); }
}`;
    return buildBindInjectedRender(src, "/app/flow/pages/demo.tsx");
  }

  it("adds __flowBinds for show/bind/query on component elements", () => {
    const out = inject(
      `<Sheet show={this.open}><Checkbox bind={this.terms} /></Sheet>`,
      "@expose open = false; @expose terms = false;",
    );
    expect(out).not.toBeNull();
    expect(out).toContain(`__flowBinds={{ show: "open" }}`);
    expect(out).toContain(`__flowBinds={{ bind: "terms" }}`);
    // Emits a standalone render module the pipeline can import.
    expect(out).toContain("export async function render()");
  });

  it("maps query→query and bind→bind on one element", () => {
    const out = inject(
      `<Combobox bind={this.cityId} query={this.citySearch} />`,
      "@expose cityId = ''; @expose citySearch = '';",
    );
    expect(out).toContain(`__flowBinds={{ bind: "cityId", query: "citySearch" }}`);
  });

  it("returns null when there is nothing to inject (no component bindings)", () => {
    expect(inject(`<div>{this.open}</div>`, "@expose open = false;")).toBeNull();
    // Intrinsic value=/checked= are resolved elsewhere; not a component binding.
    expect(inject(`<input value={this.open} />`, "@expose open = false;")).toBeNull();
  });

  it("does not touch an element that already declares __flowBinds", () => {
    const out = inject(
      `<Sheet show={this.open} __flowBinds={{ show: "custom" }} />`,
      "@expose open = false;",
    );
    // Nothing else to inject → whole render has no change → null.
    expect(out).toBeNull();
  });
});

describe("Flow compiler — @computed in templates", () => {
  const COMPUTED = "@computed get uptime() { return '1m'; }";

  it("allows a @computed getter in a text child (static value)", () => {
    const r = compile(`<p>up {this.uptime}</p>`, COMPUTED);
    expect(r).not.toBeNull(); // no longer bails to runtime
    expect(html(r)).toContain("__esc(this.uptime)");
  });

  it("allows @computed in a Number()/String() cast text child", () => {
    expect(html(compile(`<p>{String(this.uptime)}</p>`, COMPUTED))).toContain("__esc(this.uptime)");
  });

  it("still rejects @computed in a reactive text= binding, with a helpful message", () => {
    expect(() => compile(`<p text={this.uptime} />`, COMPUTED)).toThrow(/@computed/);
  });

  it("still rejects an unknown prop in a text child", () => {
    expect(() => compile(`<p>{this.nope}</p>`)).toThrow(/does not match/);
  });
});

describe("Flow compiler — server-evaluated `$flow` diagnostics", () => {
  const MEMBERS = '@expose todos: {id: string; text: string}[] = []; @expose draft = "";';

  it("does not flag `$flow` inside a handler nested in a child expression", () => {
    // The read lives in an onClick inside a <For> render callback. Handlers are
    // serialised to a flow:* attribute and never run on the server, so accusing
    // the page of a server-evaluated read would be plain wrong.
    expect(() =>
      compile(
        `<For each={this.todos} keyBy="id">
           {(todo) => (
             <li>{todo.text}
               <button onClick={() => $flow.call("removeTodo", todo.id)}>x</button>
             </li>
           )}
         </For>`,
        MEMBERS,
      ),
    ).not.toThrow();
  });

  it("does not flag `$flow` in a handler on an uncompilable page", () => {
    // Same rule, but with a component forcing the runtime fallback — the path
    // that reaches the diagnostic at all.
    expect(() =>
      compile(
        `<Demo code="x"><button onClick={() => $flow.call("addTodo")}>Add</button></Demo>`,
        MEMBERS,
      ),
    ).not.toThrow();
  });

  it("still reports a real `$flow` read, with the line and column of the read", () => {
    let message = "";
    try {
      compile(`<Demo code="x"><p>{$flow.$store.ui.dark ? "on" : "off"}</p></Demo>`, MEMBERS);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("reads `$flow` in a text child");
    expect(message).toMatch(/demo\.tsx:\d+:\d+ {2}← the `\$flow` read/);
  });

  it("reports a `$flow` attribute binding by attribute name", () => {
    let message = "";
    try {
      compile(`<Demo code="x"><input value={$flow.$store.ui.name} /></Demo>`, MEMBERS);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("reads `$flow` in a `value=` binding");
  });

  it("names the blocker that forced the fallback, with its location", () => {
    let message = "";
    try {
      compile(`<Demo code="x"><p>{$flow.$store.ui.dark}</p></Demo>`, MEMBERS);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("What stops it compiling:");
    expect(message).toContain("`<Demo>` is a component, not an HTML element");
    expect(message).toMatch(/demo\.tsx:\d+:\d+ {2}`<Demo>`/);
  });
});

describe("Flow compiler — fallback blockers", () => {
  /** Compile and return the blocker the compiler recorded, if it fell back. */
  function blockerFor(body: string, members?: string): { reason: string; fix: string } | undefined {
    const report: BlockerReport = {};
    transformFlowFile(page(body, members), "/app/flow/pages/demo.tsx", { report });
    return report.blocker;
  }

  it("names an imported component", () => {
    expect(blockerFor(`<div><Demo code="x" /></div>`)?.reason).toContain(
      "`<Demo />` is a component",
    );
  });

  it("names a numeric-literal attribute and gives the exact rewrite", () => {
    const blocker = blockerFor(`<textarea rows={3} />`);
    expect(blocker?.reason).toContain("`rows={3}` is a numeric literal");
    expect(blocker?.fix).toBe('write rows="3"');
  });

  it("names a computed class", () => {
    expect(blockerFor(`<div class={SUFFIX}>x</div>`)?.reason).toContain(
      "is not a static class string",
    );
  });

  it("names a style object", () => {
    expect(blockerFor(`<div style={{ color: "red" }}>x</div>`)?.reason).toContain(
      "`style={{ … }}` is an object literal",
    );
  });

  it("records nothing when the page compiles", () => {
    expect(blockerFor(`<div class="ok">x</div>`)).toBeUndefined();
  });

  it("reports a line and column that point at the offending source", () => {
    const report: BlockerReport = {};
    const source = `/** @jsxImportSource @zerotal/flow */
import { Component } from '@zerotal/flow';
import { Card } from './Card.tsx';
export class DemoPage extends Component {
  override async render() {
    return (
      <div>
        <Card title="hi" />
      </div>
    );
  }
}`;
    transformFlowFile(source, "/app/flow/pages/demo.tsx", { report });
    expect(report.blocker?.line).toBe(8);
    expect(report.blocker?.column).toBe(10);
  });
});
