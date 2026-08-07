/** @jsxImportSource @zerotal/flow */
// Admin home: a friendly overview with a card per registered resource.

import { Component, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { AdminLayout, makeAdminLayout } from "../ui/AdminLayout.tsx";
import { Icon } from "../ui/icons.tsx";
import { Panel } from "../Panel.ts";
import type { PanelInstance } from "../PanelInstance.ts";
import { widgetPollInterval } from "../widgets/Widget.ts";
import { renderWidgets } from "../widgets/render.tsx";
import type { DashboardWidget } from "../widgets/Widget.ts";
import { applyLayout, moveKey, reconcile } from "../dashboardLayout.ts";

export class DashboardPage extends Component {
  static layout = AdminLayout;
  /** The panel this page belongs to — set by each generated subclass. */
  static panel: PanelInstance;

  private get _panel(): PanelInstance {
    return (this.constructor as typeof DashboardPage).panel ?? Panel.current();
  }

  /** Whether the arrange controls are showing. */
  @expose arranging = false;
  /** Every widget on this dashboard, keyed — recomputed each render. */
  private _keyed: { key: string; widget: DashboardWidget; title: string }[] = [];

  @expose toggleArranging(): void {
    this.arranging = !this.arranging;
  }

  /** The declared widgets, in declaration order, with their stored identities. */
  private async _allWidgets(): Promise<{ key: string; widget: DashboardWidget; title: string }[]> {
    const panel = this._panel;
    const widgets = [...panel.dashboardWidgets(), ...(await panel.visibleWidgets())];
    return widgets.map((widget, index) => ({
      key: widget.widgetKey(index),
      widget,
      title: (widget as { _title?: string })._title ?? "Overview",
    }));
  }

  /** Read the current layout, reconciled against the widgets that exist now. */
  private async _layout(): Promise<{ order: string[]; hidden: string[] } | null> {
    const store = this._panel.dashboardLayoutStore();
    if (!store) return null;
    const keys = (await this._allWidgets()).map((k) => k.key);
    return reconcile(await store.load(), keys);
  }

  @expose async moveWidget(key: unknown, direction: unknown): Promise<void> {
    const store = this._panel.dashboardLayoutStore();
    const layout = await this._layout();
    if (!store || !layout) return;
    await store.save({
      ...layout,
      order: moveKey(layout.order, String(key), Number(direction) < 0 ? -1 : 1),
    });
  }

  @expose async toggleWidget(key: unknown): Promise<void> {
    const store = this._panel.dashboardLayoutStore();
    const layout = await this._layout();
    if (!store || !layout) return;
    const id = String(key);
    await store.save({
      ...layout,
      hidden: layout.hidden.includes(id)
        ? layout.hidden.filter((k) => k !== id)
        : [...layout.hidden, id],
    });
  }

  /** Put the dashboard back the way the app declares it. */
  @expose async resetLayout(): Promise<void> {
    const store = this._panel.dashboardLayoutStore();
    if (!store) return;
    await store.save({ order: [], hidden: [] });
    this.flash("Dashboard reset.", "success");
  }

  /** The "Arrange" toggle, with a note when something is hidden. */
  private _arrangeBar(
    layout: { order: string[]; hidden: string[] },
    hiddenCount: number,
  ): HtmlNode {
    return (
      <div class="flex items-center justify-end gap-3 text-sm">
        {hiddenCount > 0 ? (
          <span class="text-xs text-muted-foreground">
            {hiddenCount} widget{hiddenCount === 1 ? "" : "s"} hidden
          </span>
        ) : null}
        <button
          type="button"
          onClick={this.toggleArranging}
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input px-3 text-xs font-medium transition hover:bg-accent"
        >
          <Icon name="filter" class="h-3.5 w-3.5" />
          {this.arranging ? "Done" : "Arrange"}
        </button>
        {layout.order.length > 0 || layout.hidden.length > 0 ? (
          <button
            type="button"
            onClick={this.resetLayout}
            confirm="Put the dashboard back the way it started?"
            class="text-xs text-muted-foreground transition hover:text-foreground"
          >
            Reset
          </button>
        ) : null}
      </div>
    );
  }

  /** One row per widget: move up, move down, show or hide. */
  private _arrangePanel(layout: { order: string[]; hidden: string[] }): HtmlNode {
    // Listed in the saved order rather than declaration order, so what is on
    // screen matches what the rows say.
    const rows = layout.order
      .map((key) => this._keyed.find((k) => k.key === key))
      .filter((k): k is (typeof this._keyed)[number] => Boolean(k));

    return (
      <div class="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map((row, index) => {
          const hidden = layout.hidden.includes(row.key);
          return (
            <div class="flex items-center gap-3 px-3 py-2">
              <span class={`flex-1 text-sm ${hidden ? "text-muted-foreground line-through" : ""}`}>
                {row.title}
              </span>
              <button
                type="button"
                onClick={this.moveWidget}
                data-args={JSON.stringify([row.key, -1])}
                disabled={index === 0}
                aria-label={`Move ${row.title} up`}
                class="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-30"
              >
                <Icon name="chevron-up" class="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={this.moveWidget}
                data-args={JSON.stringify([row.key, 1])}
                disabled={index === rows.length - 1}
                aria-label={`Move ${row.title} down`}
                class="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-30"
              >
                <Icon name="chevron-down" class="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={this.toggleWidget}
                data-args={JSON.stringify([row.key])}
                aria-label={`${hidden ? "Show" : "Hide"} ${row.title}`}
                class="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <Icon name="eye" class="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  override async render(): Promise<HtmlNode> {
    const panel = this._panel;
    const cfg = panel.config();
    // A nested resource has no URL without a parent record, so it gets no card.
    const resources = panel.resources().filter((r) => !r.parent);

    // The app's widgets first, then whatever packages contributed and this user
    // may see — so a contributed widget never displaces the app's own headline.
    // A saved layout then reorders and hides within that, per user.
    this._keyed = await this._allWidgets();
    const store = panel.dashboardLayoutStore();
    const layout = store
      ? reconcile(
          await store.load(),
          this._keyed.map((k) => k.key),
        )
      : null;
    const arranged = applyLayout(this._keyed, (k) => k.key, layout);
    const widgets = arranged.visible.map((k) => k.widget);
    const widgetBlock = await renderWidgets(widgets);

    // The keenest widget sets the page's refresh rate; with none, this renders
    // once per navigation as before.
    const poll = widgetPollInterval(widgets);

    return (
      <div class="mx-auto w-full max-w-7xl space-y-8" {...(poll ? { poll: { every: poll } } : {})}>
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">Welcome to {cfg.brand}</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Manage your application's data from one place.
          </p>
        </div>

        {store ? this._arrangeBar(layout!, arranged.hidden.length) : null}
        {this.arranging && store ? this._arrangePanel(layout!) : null}

        {widgetBlock}

        {resources.length > 0 ? (
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {resources.map((r) => (
              <a
                href={r.indexUrl(panel.base())}
                navigate
                class="group relative overflow-hidden rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm transition hover:border-primary/40 hover:shadow-md"
              >
                <div class="flex items-center gap-3">
                  <div class="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon name={r.navigationIcon} class="h-5 w-5" />
                  </div>
                  <div class="min-w-0">
                    <div class="font-medium leading-tight">{r.getPluralLabel()}</div>
                    {r.navigationGroup ? (
                      <div class="text-xs text-muted-foreground">{r.navigationGroup}</div>
                    ) : null}
                  </div>
                </div>
                <div class="mt-4 flex items-center gap-1 text-sm font-medium text-primary">
                  Manage
                  <Icon
                    name="chevron-right"
                    class="h-4 w-4 transition group-hover:translate-x-0.5"
                  />
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div class="rounded-xl border border-dashed border-border p-12 text-center">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon name="layout-grid" class="h-6 w-6" />
            </div>
            <p class="mt-3 text-sm font-medium">No resources registered yet</p>
            <p class="mt-1 text-sm text-muted-foreground">
              Register one with{" "}
              <code class="rounded bg-muted px-1.5 py-0.5">Panel.register(...)</code> in your admin
              bootstrap file.
            </p>
          </div>
        )}
      </div>
    );
  }
}

/** The dashboard for one panel, showing only that panel's resources and widgets. */
export function makeDashboardPage(panel: PanelInstance = Panel.default()): typeof DashboardPage {
  const Page = class extends DashboardPage {
    static override panel = panel;
    static override layout = makeAdminLayout(panel);
  };
  Object.defineProperty(Page, "name", { value: "DashboardPage" });
  return Page;
}
