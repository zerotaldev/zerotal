/** @jsxImportSource @zerotal/flow */
import { Component, expose, For } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { ShowcaseLayout } from "../ShowcaseLayout.tsx";
import { Demo } from "../Demo.tsx";

interface Todo {
  id: string;
  text: string;
}

const CODE = `@expose todos: Todo[] = [];
@expose draft = "";

@expose addTodo() {
  this.todos.push({ id: crypto.randomUUID(), text: this.draft });
  this.draft = "";
}
@expose removeTodo(id: string) {
  this.todos = this.todos.filter((t) => t.id !== id);
}

// optimistic add: shows now, reconciles when the action's patch lands
<button onClick={() => {
  $flow.appendOptimistic("todos", { id: \`tmp-\${Date.now()}\`, text: this.draft });
  $flow.call("addTodo");
}}>Add</button>

// <For> — a reactive list (compiles to an Alpine x-for)
<For each={this.todos} keyBy="id">
  {(todo) => (
    <li>{todo.text}
      <button onClick={() => $flow.call("removeTodo", todo.id)}>×</button>
    </li>
  )}
</For>`;

/**
 * Reactive lists + optimistic collections. `<For>` compiles to an Alpine `x-for`, so a client
 * mutation of the array re-renders instantly. Add optimistically appends the row
 * (`$flow.appendOptimistic`) and then dispatches the server action; the row shows at once and is
 * reconciled to the server's authoritative list when the patch lands.
 */
export class ListsPage extends Component {
  static title = "Reactive lists — Flow showcase";

  @expose todos: Todo[] = [
    { id: "seed-1", text: "Open the network tab" },
    { id: "seed-2", text: "Add an item and watch it appear instantly" },
  ];
  @expose draft = "";

  @expose addTodo(): void {
    const text = this.draft.trim();
    if (!text) return;
    this.todos.push({ id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text });
    this.draft = "";
  }

  @expose removeTodo(id: string): void {
    this.todos = this.todos.filter((t) => t.id !== id);
  }

  override layout(page: HtmlNode): HtmlNode {
    return <ShowcaseLayout>{page}</ShowcaseLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const input =
      "flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-400 focus:outline-none";

    return (
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900">Reactive lists</h1>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">
            The list renders with <code class="font-mono text-orange-600">&lt;For&gt;</code>, so any
            client change re-renders it without a round-trip. <strong>Add</strong> appends
            optimistically and then persists on the server; the row appears the instant you click
            and reconciles when the patch lands. Each <strong>×</strong> is a server action.
          </p>
        </div>

        <Demo code={CODE}>
          <div class="flex gap-2">
            <input value={this.draft} live placeholder="What needs doing?" class={input} />
            <button
              onClick={() => {
                $flow.appendOptimistic("todos", { id: `tmp-${Date.now()}`, text: this.draft });
                $flow.call("addTodo");
              }}
              class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600"
            >
              Add
            </button>
          </div>

          <ul class="mt-4 space-y-2">
            <For each={this.todos} keyBy="id">
              {(todo) => (
                <li class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm">
                  <span>{todo.text}</span>
                  <button
                    onClick={() => $flow.call("removeTodo", todo.id)}
                    class="text-slate-400 transition hover:text-red-500"
                  >
                    ×
                  </button>
                </li>
              )}
            </For>
          </ul>

          <p class="mt-4 text-xs text-slate-400">
            {this.todos.length} item{this.todos.length === 1 ? "" : "s"}. The optimistic row
            survives interim patches and rolls back on its own if the server action fails.
          </p>
        </Demo>
      </div>
    );
  }
}
