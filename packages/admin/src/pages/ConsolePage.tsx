/** @jsxImportSource @zerotal/flow */
// Renders a ConsoleContribution: tabbed tables with row and header actions.
// The active tab lives in an `@url` prop so a console is linkable and survives a
// refresh; actions re-resolve the rows afterwards so the table reflects what the
// action just did without a full navigation.

import { Component, url, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Table } from "@zerotal/flow-ui";
import type { TableColumn } from "@zerotal/flow-ui";
import { AdminLayout, makeAdminLayout } from "../ui/AdminLayout.tsx";
import { Icon } from "../ui/icons.tsx";
import { Panel } from "../Panel.ts";
import type { PanelInstance } from "../PanelInstance.ts";
import { AdminForbiddenError } from "../support/authorize.ts";
import type {
  ConsoleColumn,
  ConsoleContribution,
  ConsoleHeaderAction,
  ConsoleRow,
  ConsoleTab,
} from "../plugin.ts";
import type { BadgeTone } from "../table/Column.ts";

const BADGE_TONE: Record<BadgeTone, string> = {
  default: "bg-secondary text-secondary-foreground",
  primary: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20",
  success: "bg-success/10 text-success ring-1 ring-inset ring-success/20",
  muted: "bg-muted text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20",
};

const ALIGN: Record<string, string> = {
  start: "text-left",
  center: "text-center",
  end: "text-right tabular-nums",
};

/** @internal */
export class ConsolePage extends Component {
  static layout = AdminLayout;

  /** Set on the per-console subclass by {@link makeConsolePage}. */
  static console: ConsoleContribution;
  /** The panel this console belongs to — set by {@link makeConsolePage}. */
  static panel: PanelInstance;

  @url tab = "";

  /** Rows for the active tab, resolved on mount and after every action. */
  @expose rows: ConsoleRow[] = [];
  @expose tabBadges: Record<string, number> = {};

  private get _console(): ConsoleContribution {
    return (this.constructor as typeof ConsolePage).console;
  }

  private get _panel(): PanelInstance {
    return (this.constructor as typeof ConsolePage).panel ?? Panel.current();
  }

  private _activeTab(): ConsoleTab {
    const tabs = this._console.tabs;
    return tabs.find((t) => t.key === this.tab) ?? (tabs[0] as ConsoleTab);
  }

  override async onMount(): Promise<void> {
    await this._load();
  }

  private async _load(): Promise<void> {
    const tab = this._activeTab();
    this.rows = tab ? await tab.rows() : [];

    const badges: Record<string, number> = {};
    await Promise.all(
      this._console.tabs.map(async (t) => {
        if (!t.badge) return;
        try {
          const n = await t.badge();
          if (n !== null && n !== undefined) badges[t.key] = n;
        } catch {
          /* a failing count must not take the console down */
        }
      }),
    );
    this.tabBadges = badges;
  }

  /**
   * Re-read the active tab. Exposed so the refresh control and the client-side
   * confirmation flow can both land here.
   */
  @expose async refresh(): Promise<void> {
    await this._load();
  }

  @expose async switchTab(key: unknown): Promise<void> {
    const tab = this._console.tabs.find((t) => t.key === key);
    if (!tab) return;
    this.tab = tab.key;
    await this._load();
  }

  /**
   * Run a row action.
   *
   * The ability is asserted here rather than trusted from the render pass: these
   * are `@expose`d methods dispatched straight from a client frame, so a user who
   * can load the page could otherwise call them with arguments of their choosing.
   */
  @expose async runRowAction(key: unknown, rowKey: unknown): Promise<void> {
    await this._authorize();
    const tab = this._activeTab();
    const action = tab?.rowActions?.find((a) => a.key === key);
    if (!action) return;

    const idKey = tab.rowKey ?? "id";
    const row = this.rows.find((r) => String(r[idKey]) === String(rowKey));
    if (!row) return;

    await this._run(() => action.run(row));
  }

  @expose async runHeaderAction(key: unknown): Promise<void> {
    await this._authorize();
    const action = this._activeTab()?.headerActions?.find((a) => a.key === key);
    if (!action) return;
    await this._run(() => action.run());
  }

  /** Re-check the console's ability on every dispatched action. */
  private async _authorize(): Promise<void> {
    if (!(await this._panel.can(this._console.ability))) {
      throw new AdminForbiddenError(this._console.title);
    }
  }

  /** Run an action, flash whatever it reports, and re-read the table either way. */
  private async _run(fn: () => Promise<string | void> | string | void): Promise<void> {
    try {
      const message = await fn();
      if (message) this.flash(message, "success");
    } catch (err) {
      this.flash(err instanceof Error ? err.message : String(err), "error");
    }
    await this._load();
  }

  override async render(): Promise<HtmlNode> {
    const console = this._console;
    const active = this._activeTab();
    if (!active) return <div class="text-sm text-muted-foreground">This console has no tabs.</div>;

    const columns: TableColumn[] = active.columns.map((c) => ({
      key: c.key,
      label: c.label,
      class: cellClass(c),
      render: (row: ConsoleRow) => cell(c, row),
    }));

    if (active.rowActions?.length) {
      columns.push({
        key: "__actions",
        label: "",
        class: "text-right",
        render: (row: ConsoleRow) => this._rowActions(active, row),
      });
    }

    return (
      <div class="mx-auto w-full max-w-7xl space-y-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 class="text-2xl font-semibold tracking-tight">{console.title}</h1>
            {active.description ? (
              <p class="mt-1 text-sm text-muted-foreground">{active.description}</p>
            ) : null}
          </div>
          <div class="flex items-center gap-2">
            {(active.headerActions ?? []).map((a) => this._headerAction(a))}
            <button
              type="button"
              onClick={this.refresh}
              class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Icon name="undo" class="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {console.tabs.length > 1 ? (
          <div class="flex flex-wrap items-center gap-1 border-b border-border">
            {console.tabs.map((t) => {
              const isActive = t.key === active.key;
              const count = this.tabBadges[t.key];
              return (
                <button
                  type="button"
                  onClick={this.switchTab}
                  data-args={JSON.stringify([t.key])}
                  class={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                  {count !== undefined ? (
                    <span class="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      {String(count)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        <div class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
          <div class="overflow-x-auto p-1.5">
            {this.rows.length > 0 ? (
              <Table columns={columns} rows={this.rows} hover />
            ) : (
              <p class="px-4 py-12 text-center text-sm text-muted-foreground">
                {active.empty ?? "Nothing here."}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  private _rowActions(tab: ConsoleTab, row: ConsoleRow): HtmlNode {
    const idKey = tab.rowKey ?? "id";
    const rowKey = String(row[idKey] ?? "");
    return (
      <div class="flex items-center justify-end gap-1">
        {(tab.rowActions ?? []).map((a) => (
          <button
            type="button"
            onClick={this.runRowAction}
            data-args={JSON.stringify([a.key, rowKey])}
            {...(a.confirm ? { confirm: a.confirm } : {})}
            class={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
              a.danger
                ? "text-destructive hover:bg-destructive/10"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            {a.icon ? <Icon name={a.icon} class="h-3.5 w-3.5" /> : null}
            {a.label}
          </button>
        ))}
      </div>
    );
  }

  private _headerAction(a: ConsoleHeaderAction): HtmlNode {
    return (
      <button
        type="button"
        onClick={this.runHeaderAction}
        data-args={JSON.stringify([a.key])}
        {...(a.confirm ? { confirm: a.confirm } : {})}
        class={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
          a.danger
            ? "border border-destructive/30 text-destructive hover:bg-destructive/10"
            : "border border-input bg-background hover:bg-accent hover:text-accent-foreground"
        }`}
      >
        {a.icon ? <Icon name={a.icon} class="h-4 w-4" /> : null}
        {a.label}
      </button>
    );
  }
}

function cellClass(c: ConsoleColumn): string {
  return [ALIGN[c.align ?? "start"], c.mono ? "font-mono text-xs" : ""].filter(Boolean).join(" ");
}

function cell(c: ConsoleColumn, row: ConsoleRow): HtmlNode | string {
  const raw = row[c.key];
  const text = c.format
    ? c.format(raw, row)
    : raw === null || raw === undefined
      ? "—"
      : String(raw);
  const tone = c.badge?.(raw, row) ?? null;
  if (!tone) return text;
  return (
    <span
      class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONE[tone]}`}
    >
      {text}
    </span>
  );
}

/**
 * Build the page class for one console. A subclass per console — rather than one
 * shared class resolving itself from the route — keeps the console on a static
 * and matches how resource list pages are generated. The explicit name matters:
 * Flow's component registry is keyed by constructor name.
 *
 * @internal
 */
export function makeConsolePage(
  console: ConsoleContribution,
  panel: PanelInstance = Panel.default(),
): typeof ConsolePage {
  const Page = class extends ConsolePage {
    static override console = console;
    static override panel = panel;
    static override layout = makeAdminLayout(panel);
  };
  const pascal = console.slug
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  Object.defineProperty(Page, "name", { value: `${pascal}ConsolePage` });
  return Page;
}
