/** @jsxImportSource @zerotal/flow */
// Notification center — lists the current user's notifications (resolved by the
// app-supplied provider), highlights unread ones, and offers mark-as-read /
// mark-all-read. Reactive: marking re-renders the list server-side.

import { Component, expose, on } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { AdminLayout, makeAdminLayout } from "../ui/AdminLayout.tsx";
import { Icon } from "../ui/icons.tsx";
import { Panel } from "../Panel.ts";
import type { PanelInstance } from "../PanelInstance.ts";

export class NotificationsPage extends Component {
  static layout = AdminLayout;
  /** The panel this page belongs to — set by each generated subclass. */
  static panel: PanelInstance;

  private get _panel(): PanelInstance {
    return (this.constructor as typeof NotificationsPage).panel ?? Panel.current();
  }

  @expose async markRead(id: unknown): Promise<void> {
    await this._panel.notificationProvider()?.markRead?.(String(id));
  }

  @expose async markAllRead(): Promise<void> {
    await this._panel.notificationProvider()?.markAllRead?.();
  }

  /**
   * Broadcast listener. When the app broadcasts a notification on
   * the `admin-notifications` channel, this fires server-side and the resulting
   * re-render re-resolves the list — so a new notification appears live. The body
   * is intentionally empty: the re-render does the work.
   */
  @on("echo:admin-notifications,.notification.sent")
  onBroadcast(): void {}

  override async render(): Promise<HtmlNode> {
    const provider = this._panel.notificationProvider();
    const base = this._panel.base();
    const items = provider ? await provider.resolve() : [];
    const unread = items.filter((n) => !n.read).length;
    const canMarkAll = !!provider?.markAllRead;
    const canMarkOne = !!provider?.markRead;

    return (
      // Polls every 20s and listens for Echo broadcasts → new notifications arrive live.
      <div class="mx-auto w-full max-w-2xl space-y-6" poll={{ every: "20s" }}>
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <nav class="mb-1 text-xs text-muted-foreground">
              <a href={base} navigate class="hover:text-foreground">
                Dashboard
              </a>
              <span class="px-1.5">/</span>
              <span>Notifications</span>
            </nav>
            <h1 class="text-2xl font-semibold tracking-tight">Notifications</h1>
            <p class="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                {unread} unread of {items.length}
              </span>
              {provider ? (
                <span class="inline-flex items-center gap-1 text-xs text-success">
                  <span class="h-1.5 w-1.5 rounded-full bg-success" /> Live
                </span>
              ) : null}
            </p>
          </div>
          {canMarkAll && unread > 0 ? (
            <button
              type="button"
              onClick={this.markAllRead}
              class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm font-medium transition hover:bg-accent hover:text-accent-foreground"
            >
              <Icon name="check-circle" class="h-4 w-4" /> Mark all read
            </button>
          ) : null}
        </div>

        {!provider ? (
          <div class="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            No notification provider configured. Call{" "}
            <code class="rounded bg-muted px-1.5 py-0.5">Panel.notifications(...)</code>.
          </div>
        ) : items.length === 0 ? (
          <div class="rounded-xl border border-dashed border-border p-12 text-center">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon name="bell" class="h-6 w-6" />
            </div>
            <p class="mt-3 text-sm font-medium">You're all caught up</p>
          </div>
        ) : (
          <div class="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
            <ul class="divide-y divide-border">
              {items.map((n) => (
                <li class={`flex items-start gap-3 px-4 py-3 ${n.read ? "" : "bg-primary/5"}`}>
                  <span
                    class={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      n.read ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                    }`}
                  >
                    <Icon name={n.icon ?? "bell"} class="h-4 w-4" />
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      {n.href ? (
                        <a
                          href={n.href}
                          navigate
                          class="truncate text-sm font-medium hover:underline"
                        >
                          {n.title}
                        </a>
                      ) : (
                        <span class="truncate text-sm font-medium">{n.title}</span>
                      )}
                      {n.read ? null : <span class="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                    </div>
                    {n.body ? <p class="mt-0.5 text-sm text-muted-foreground">{n.body}</p> : null}
                    {n.time ? <p class="mt-1 text-xs text-muted-foreground/70">{n.time}</p> : null}
                  </div>
                  {canMarkOne && !n.read ? (
                    <button
                      type="button"
                      onClick={this.markRead}
                      data-args={JSON.stringify([n.id])}
                      title="Mark read"
                      class="shrink-0 rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    >
                      <Icon name="check-circle" class="h-4 w-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
}

/** The notification centre for one panel, reading that panel's provider. */
export function makeNotificationsPage(
  panel: PanelInstance = Panel.default(),
): typeof NotificationsPage {
  const Page = class extends NotificationsPage {
    static override panel = panel;
    static override layout = makeAdminLayout(panel);
  };
  Object.defineProperty(Page, "name", { value: "NotificationsPage" });
  return Page;
}
