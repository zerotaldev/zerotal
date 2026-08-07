import { describe, it, expect } from "bun:test";
import { transformFlowFile } from "./transform.ts";

function page(body: string, members: string): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component, expose, locked, For } from '@zerotal/flow';
export class DemoPage extends Component {
  ${members}
  override async render() { return (${body}); }
}`;
}
const compile = (body: string, members: string) =>
  transformFlowFile(page(body, members), "/app/flow/pages/demo.tsx");
const html = (r: { renderBody: string } | null) => (r ? r.renderBody.replace(/\\/g, "") : "");

describe("Flow compiler — <For> reactive list", () => {
  it("compiles to an Alpine <template x-for> with x-text and :key", () => {
    const r = compile(
      `<For each={this.todos} keyBy="id">{(t) => <li>{t.text}</li>}</For>`,
      "@expose todos = [];",
    );
    expect(r).not.toBeNull();
    expect(html(r)).toContain('<template x-for="t in $flow.todos" :key="t.id">');
    expect(html(r)).toContain('<li x-text="t.text"></li>');
    expect(html(r)).toContain("</template>");
  });

  it("maps class/className to :class and on* arrows to Alpine @event (this→$flow)", () => {
    const r = compile(
      `<For each={this.todos} keyBy="id">{(t) => (
         <li class={t.done ? "done" : ""} onClick={() => this.remove(t.id)}>
           {t.text}
         </li>
       )}</For>`,
      "@expose todos = []; @expose remove(id) {}",
    );
    const out = html(r);
    expect(out).toContain(':class="t.done ?'); // reactive class binding (attr value HTML-escaped)
    expect(out).toContain('@click="$flow.remove('); // arrow unwrapped, this→$flow
    expect(out).not.toContain("this.remove"); // rewritten
  });

  it("AOT-rewrites a bare $flow magic in a For arrow ($flow.removeOptimistic → $flow.$removeOptimistic)", () => {
    const r = compile(
      `<For each={this.todos} keyBy="id">{(t) => (
         <li onClick={() => $flow.removeOptimistic("todos", (x) => x.id === t.id)}>{t.text}</li>
       )}</For>`,
      "@expose todos = [];",
    );
    expect(html(r)).toContain('@click="$flow.$removeOptimistic(');
  });

  it("supports nested elements and reactive attrs", () => {
    const r = compile(
      `<For each={this.items} keyBy="id">{(item) => (
         <div class="row"><span>{item.name}</span><a href={item.url}>open</a></div>
       )}</For>`,
      "@expose items = [];",
    );
    const out = html(r);
    expect(out).toContain('<div class="row">');
    expect(out).toContain('<span x-text="item.name"></span>');
    expect(out).toContain(':href="item.url"'); // reactive attr
  });

  it("errors clearly on a nested component in the item template", () => {
    expect(() =>
      compile(
        `<For each={this.todos} keyBy="id">{(t) => <li><SomeWidget /></li>}</For>`,
        "@expose todos = [];",
      ),
    ).toThrow(/<For>/);
  });

  it("errors when `each` isn't {this.<arrayProp>}", () => {
    expect(() =>
      compile(
        `<For each={someLocal} keyBy="id">{(t) => <li>{t.x}</li>}</For>`,
        "@expose todos = [];",
      ),
    ).toThrow(/each must be/);
  });
});
