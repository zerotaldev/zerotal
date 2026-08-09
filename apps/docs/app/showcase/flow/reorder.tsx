/** @jsxImportSource @zerotal/flow */
import { Component, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { ShowcaseLayout } from "../ShowcaseLayout.tsx";
import { Demo } from "../Demo.tsx";

interface Task {
  id: number;
  name: string;
}

const CODE = `@expose tasks: Task[] = [];

@expose reorder(key: string, index: number) {   // called on drop
  const moved = this.tasks.find((t) => String(t.id) === key);
  const without = this.tasks.filter((t) => t !== moved);
  without.splice(index, 0, moved);
  this.tasks = without;   // persisted — server-authoritative
}

<ul onSort={this.reorder}>
  {this.tasks.map((task) => (
    <li key={String(task.id)} sortItem={String(task.id)}>{task.name}</li>
  ))}
</ul>`;

/**
 * Drag-to-reorder. Mark the container with `onSort` (the reorder action) and each child
 * with `sortItem` (its stable key). Dropping a row calls `reorder(key, newIndex)` on the
 * server, which persists the new order — the list is server-authoritative.
 */
export class ReorderPage extends Component {
  static title = "Reorder — Flow showcase";

  @expose tasks: Task[] = [
    { id: 1, name: "Draft the proposal" },
    { id: 2, name: "Review with the team" },
    { id: 3, name: "Send for approval" },
    { id: 4, name: "Ship it" },
  ];

  @expose reorder(key: string, index: number): void {
    const moved = this.tasks.find((t) => String(t.id) === key);
    if (!moved) return;
    const without = this.tasks.filter((t) => t !== moved);
    without.splice(index, 0, moved);
    this.tasks = without;
  }

  override layout(page: HtmlNode): HtmlNode {
    return <ShowcaseLayout>{page}</ShowcaseLayout>;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900">Reorder</h1>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">
            Drag a row to reorder it. The container has{" "}
            <code class="font-mono text-orange-600">onSort</code> and each row a{" "}
            <code class="font-mono">sortItem</code> key; dropping calls the server action with the
            new index, and the server-held order is the source of truth.
          </p>
        </div>

        <Demo code={CODE}>
          <ul onSort={this.reorder} class="max-w-md space-y-2">
            {this.tasks.map((task) => (
              <li
                key={String(task.id)}
                sortItem={String(task.id)}
                class="flex cursor-grab items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm active:cursor-grabbing"
              >
                <span class="text-slate-300">⠿</span>
                {task.name}
              </li>
            ))}
          </ul>

          <p class="max-w-md text-xs text-slate-400">
            Current order: {this.tasks.map((t) => t.name).join(" → ")}
          </p>
        </Demo>
      </div>
    );
  }
}
