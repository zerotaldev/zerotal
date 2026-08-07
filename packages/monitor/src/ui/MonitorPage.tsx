/** @jsxImportSource @zerotal/flow */
import { Component, expose, locked, url } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import type { HttpContext } from "@zerotal/core";
import { MonitorLayout } from "./MonitorLayout.tsx";
import { MonitorStore } from "../MonitorStore.ts";
import { _getStore } from "../instance.ts";
import { icons } from "./icons.ts";
import { Sparkline, sparkPoints, areaPaths } from "./charts.tsx";
import {
  gaugeBar,
  gaugeText,
  methodTone,
  pctTone,
  spanColor,
  statusTone,
  toneText,
} from "./tones.ts";
import { ago, commas } from "../support/time.ts";
import { Card, CardHeader, CardTitle, Table } from "@zerotal/flow-ui";
import type { TableColumn } from "@zerotal/flow-ui";
import { MonitorPanel } from "../panel.ts";
import type {
  MonitorRow,
  MonitorSectionData,
  MonitorStat,
  MonitorTable,
  MonitorTone,
} from "../panel.ts";
import type {
  AlertEntry,
  FeedEvent,
  MonitorRange,
  MonitorSnapshot,
  RequestEntry,
  RouteDetail,
  WsAction,
} from "../store/types.ts";

interface NavItem {
  id: string;
  label: string;
  icon: string;
  badge?: "exceptions" | "queues" | "alerts";
  badgeTone?: "red" | "slate";
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: "Monitoring",
    items: [
      { id: "overview", label: "Overview", icon: icons.overview! },
      { id: "requests", label: "Requests", icon: icons.requests! },
      { id: "realtime", label: "Realtime", icon: icons.realtime! },
      {
        id: "exceptions",
        label: "Exceptions",
        icon: icons.exceptions!,
        badge: "exceptions",
        badgeTone: "red",
      },
      {
        id: "alerts",
        label: "Alerts",
        icon: icons.alerts!,
        badge: "alerts",
        badgeTone: "red",
      },
      { id: "security", label: "Security", icon: icons.security! },
      { id: "logs", label: "Logs", icon: icons.logs! },
    ],
  },
  {
    label: "Jobs & Mail",
    items: [
      { id: "queues", label: "Queues", icon: icons.queues!, badge: "queues", badgeTone: "slate" },
      { id: "mail", label: "Mail", icon: icons.mail! },
      { id: "notifications", label: "Notifications", icon: icons.notifications! },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { id: "database", label: "Database", icon: icons.database! },
      { id: "cache", label: "Cache", icon: icons.cache! },
      { id: "commands", label: "Commands", icon: icons.commands! },
      { id: "system", label: "System", icon: icons.system! },
    ],
  },
];

const RANGES: MonitorRange[] = ["live", "1h", "24h", "7d"];

/** Map a contributed section's semantic tone onto the panel's palette. */
const SECTION_TONE: Record<MonitorTone, string> = {
  default: "text-foreground",
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
};

const SECTION_BAR: Record<MonitorTone, string> = {
  default: "bg-muted-foreground",
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
};

/** Rows per page in the requests table. */
const REQ_PER_PAGE = 10;

/** Rows per page in the secondary feeds (notifications / commands / security). */
const FEED_PER_PAGE = 12;

/**
 * The production monitoring panel — a faithful, server-driven implementation of
 * `super-panel.html` built on Flow. Eight tabs (Overview, Requests,
 * Exceptions, Queues, Mail, Database, Cache, System) render from a live
 * {@link MonitorSnapshot}; interactions round-trip over the Flow WebSocket.
 */
export class MonitorPage extends Component {
  static layout = MonitorLayout;
  static title = "Zerotal · Super Panel";

  // ── UI state ──────────────────────────────────────────────────────────────
  // `tab` is driven by the URL path (/monitor/:section), seeded in onMount().
  @expose tab = "overview";
  @expose @url range: MonitorRange = "live";
  @expose live = true;
  @expose q = "";
  @expose statusFilter = "all";
  @expose activeTag = "all";
  @expose dismissed: number[] = [];
  @expose openRequestId = 0;
  @expose openExc = "";
  @expose openAlert = ""; // expanded alert card (alert id, "" = none)
  @expose openMailId = 0;
  @expose reqPage = 0; // requests table, 10 rows per page (0-indexed)
  @expose openWsAction = 0; // expanded realtime action row (action id, 0 = none)
  @expose logLevel = "all"; // Logs tab level filter
  // Shared search/filter/pagination for the secondary feeds (notifications/commands/
  // security). Safe to share: each tab is a fresh mount, so state resets on navigation.
  @expose feedQ = "";
  @expose feedStatus = "all";
  @expose feedPage = 0;
  // Per-route drill-in: which route is being inspected (empty = none). URL-bound so
  // the detail view survives a refresh and is shareable by link.
  @expose @url routeMethod = "";
  @expose @url routePath = "";

  // ── Data ──────────────────────────────────────────────────────────────────
  @locked snap!: MonitorSnapshot;
  @locked routeDetail: RouteDetail | null = null;
  /** Content of the active contributed section, resolved alongside the snapshot. */
  @locked sectionData: MonitorSectionData | null = null;

  // Branding pulled from config at boot.
  @locked brandTitle = "Super Panel";
  @locked brandSubtitle = "Zerotal Ops";
  @locked refreshMs = 3000;
  @locked basePath = "/monitor";

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  override async onMount(ctx?: HttpContext<Record<string, unknown>>): Promise<void> {
    const cfg = this._config();
    if (cfg) {
      this.brandTitle = cfg.title;
      this.brandSubtitle = cfg.subtitle;
      this.refreshMs = cfg.refreshMs;
      this.basePath = cfg.path;
    }
    // The active page comes from the URL path segment (/monitor/<section>), unless
    // a route drill-in is URL-seeded (?routeMethod=&routePath=), which wins.
    // Route params live on ctx.params (the :section binding), not as a ctx sibling.
    const section = ctx?.params["section"] as string | undefined;
    if (this.routeMethod && this.routePath) {
      this.tab = "route";
    } else if (section && this._tabIds().includes(section)) {
      this.tab = section;
    }
    await this._load();
  }

  /** Valid section ids, derived from the nav — built-in sections plus contributed ones. */
  private _tabIds(): string[] {
    return [
      ...NAV.flatMap((g) => g.items.map((i) => i.id)),
      ...MonitorPanel.sections().map((s) => s.id),
    ];
  }

  /**
   * The sidebar's groups: the built-in ones, then a group per contributed
   * section heading. Contributed sections sort after the panel's own so a
   * package can't reorder the operator's familiar navigation.
   */
  private _navGroups(): NavGroup[] {
    const contributed = MonitorPanel.sections();
    if (contributed.length === 0) return NAV;

    const groups = new Map<string, NavItem[]>();
    for (const s of contributed) {
      const label = s.group ?? "Extensions";
      const items = groups.get(label) ?? [];
      items.push({ id: s.id, label: s.label, icon: s.icon ?? icons.system! });
      groups.set(label, items);
    }
    return [...NAV, ...[...groups].map(([label, items]) => ({ label, items }))];
  }

  /** Build the deep-link URL for a section, carrying a non-live range. */
  private _sectionHref(id: string): string {
    const base = `${this.basePath.replace(/\/$/, "")}/${id}`;
    return this.range && this.range !== "live" ? `${base}?range=${this.range}` : base;
  }

  private _store(): MonitorStore {
    return _getStore() ?? new MonitorStore();
  }

  private _config(): {
    title: string;
    subtitle: string;
    refreshMs: number;
    path: string;
    retentionDays?: number;
    retentionMode?: string;
  } | null {
    try {
      const c = (
        globalThis as {
          __monitorConfig?: {
            title: string;
            subtitle: string;
            refreshMs: number;
            path: string;
            retentionDays?: number;
            retentionMode?: string;
          };
        }
      ).__monitorConfig;
      return c ?? null;
    } catch {
      return null;
    }
  }

  private async _load(): Promise<void> {
    this.snap = await this._store().snapshot(this.range);
    // Keep the open route-detail view in sync with the snapshot/range.
    if (this.tab === "route" && this.routeMethod) await this._loadRoute();
    await this._loadSection();
  }

  /**
   * Resolve the active contributed section for the current range.
   *
   * A section that throws is shown as empty rather than taking the panel down —
   * the monitor has to stay up precisely when the thing it watches is unhealthy.
   */
  private async _loadSection(): Promise<void> {
    const section = MonitorPanel.find(this.tab);
    if (!section) {
      this.sectionData = null;
      return;
    }
    try {
      this.sectionData = await section.resolve(this.range);
    } catch {
      this.sectionData = { stats: [], tables: [] };
    }
  }

  private async _loadRoute(): Promise<void> {
    this.routeDetail = await this._store().routeDetail(
      this.routeMethod,
      this.routePath,
      this.range,
    );
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  @expose setTab(id: string): void {
    this.tab = id;
  }

  /** Drill into a single route's latency/error/throughput history. */
  @expose async openRoute(method: string, path: string): Promise<void> {
    this.routeMethod = method;
    this.routePath = path;
    this.tab = "route";
    this.routeDetail = null;
    await this._loadRoute();
  }

  /** Leave the route drill-in and return to the requests list. */
  @expose backFromRoute(): void {
    this.tab = "requests";
    this.routeMethod = "";
    this.routePath = "";
    this.routeDetail = null;
  }

  @expose async setRange(r: MonitorRange): Promise<void> {
    this.range = r;
    this.live = r === "live";
    this.reqPage = 0;
    await this._load();
  }

  @expose async toggleLive(): Promise<void> {
    this.live = !this.live;
    if (!this.live && this.range === "live") this.range = "1h";
    if (this.live) this.range = "live";
    await this._load();
  }

  @expose async refreshData(): Promise<void> {
    await this._load();
  }

  @expose setStatusFilter(f: string): void {
    this.statusFilter = f;
    this.reqPage = 0;
  }

  /** Requests-table pagination (10 per page, over the loaded recent set). */
  @expose prevReqPage(): void {
    if (this.reqPage > 0) this.reqPage--;
  }

  @expose nextReqPage(): void {
    const maxPage = Math.max(0, Math.ceil(this.filteredRequests().length / REQ_PER_PAGE) - 1);
    if (this.reqPage < maxPage) this.reqPage++;
  }

  @expose setTag(t: string): void {
    this.activeTag = t;
  }

  @expose dismissAlert(i: number): void {
    if (!this.dismissed.includes(i)) this.dismissed = [...this.dismissed, i];
  }

  @expose openReq(id: number): void {
    this.openRequestId = this.openRequestId === id ? 0 : id;
  }

  @expose toggleExc(type: string): void {
    this.openExc = this.openExc === type ? "" : type;
  }

  @expose toggleAlert(id: string): void {
    this.openAlert = this.openAlert === id ? "" : id;
  }

  @expose toggleMail(id: number): void {
    this.openMailId = this.openMailId === id ? 0 : id;
  }

  @expose toggleWsAction(id: number): void {
    this.openWsAction = this.openWsAction === id ? 0 : id;
  }

  @expose setLogLevel(level: string): void {
    this.logLevel = level;
  }

  // ── Secondary-feed search / filter / pagination ─────────────────────────────

  @expose setFeedStatus(s: string): void {
    this.feedStatus = s;
    this.feedPage = 0;
  }

  @expose prevFeedPage(): void {
    if (this.feedPage > 0) this.feedPage--;
  }

  @expose nextFeedPage(): void {
    const maxPage = Math.max(0, Math.ceil(this._activeFeedTotal() / FEED_PER_PAGE) - 1);
    if (this.feedPage < maxPage) this.feedPage++;
  }

  private _matchesStatus(status: "ok" | "bad"): boolean {
    return (
      this.feedStatus === "all" ||
      (this.feedStatus === "ok" && status === "ok") ||
      (this.feedStatus === "failed" && status === "bad")
    );
  }

  private _filteredNotifications() {
    const ql = this.feedQ.trim().toLowerCase();
    return this.snap.notifications.filter(
      (n) =>
        this._matchesStatus(n.status) &&
        (ql === "" || `${n.notification} ${n.recipient} ${n.channel}`.toLowerCase().includes(ql)),
    );
  }

  private _filteredCommands() {
    const ql = this.feedQ.trim().toLowerCase();
    return this.snap.commands.filter(
      (c) => this._matchesStatus(c.status) && (ql === "" || c.name.toLowerCase().includes(ql)),
    );
  }

  private _filteredSecurity() {
    const ql = this.feedQ.trim().toLowerCase();
    if (ql === "") return this.snap.security;
    return this.snap.security.filter((e) =>
      `${e.label} ${e.detail} ${e.route ?? ""}`.toLowerCase().includes(ql),
    );
  }

  private _filteredWsActions() {
    const ql = this.feedQ.trim().toLowerCase();
    return this.snap.realtime.recentActions.filter(
      (a) =>
        this._matchesStatus(a.ok ? "ok" : "bad") &&
        (ql === "" ||
          `${a.component} ${a.action} ${a.user ?? ""} ${a.ip ?? ""}`.toLowerCase().includes(ql)),
    );
  }

  private _activeFeedTotal(): number {
    if (this.tab === "notifications") return this._filteredNotifications().length;
    if (this.tab === "commands") return this._filteredCommands().length;
    if (this.tab === "security") return this._filteredSecurity().length;
    if (this.tab === "realtime") return this._filteredWsActions().length;
    return 0;
  }

  /** Pagination math for the active secondary feed. */
  private _feedSlice(total: number): {
    page: number;
    totalPages: number;
    start: number;
    end: number;
  } {
    const totalPages = Math.max(1, Math.ceil(total / FEED_PER_PAGE));
    const page = Math.min(Math.max(0, this.feedPage), totalPages - 1);
    const start = page * FEED_PER_PAGE;
    return { page, totalPages, start, end: start + FEED_PER_PAGE };
  }

  @expose async pauseQueue(name: string): Promise<void> {
    const paused = this._store().toggleQueuePaused(name);
    await this._load();
    this.flash(`Queue "${name}" ${paused ? "paused" : "resumed"}.`, paused ? "warning" : "success");
  }

  @expose async retryJob(id: number): Promise<void> {
    await this._store().retryFailed(id);
    await this._load();
    this.flash("Job re-queued for retry.", "success");
  }

  @expose async requeueDead(id: number): Promise<void> {
    await this._store().requeueDead(id);
    await this._load();
    this.flash("Dead-letter job requeued.", "success");
  }

  /** Prune data past the retention window now (delete or archive per config). */
  @expose async cleanupData(): Promise<void> {
    const removed = this._store().prune();
    await this._load();
    this.flash(
      removed > 0
        ? `Pruned ${removed} record${removed === 1 ? "" : "s"} past retention.`
        : "Nothing to prune — all data is within retention.",
      "success",
    );
  }

  /** Permanently delete every recorded sample. */
  @expose async clearData(): Promise<void> {
    const removed = this._store().wipe();
    await this._load();
    this.flash(`Cleared ${removed} record${removed === 1 ? "" : "s"}.`, "warning");
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  private badge(kind: "exceptions" | "queues" | "alerts"): number {
    if (!this.snap) return 0;
    if (kind === "exceptions") return this.snap.exceptions.reduce((a, e) => a + e.count, 0);
    if (kind === "alerts") return this.snap.alertHistory.length;
    return this.snap.queues.reduce((a, q) => a + q.pending, 0);
  }

  private filteredRequests(): RequestEntry[] {
    const ql = this.q.trim().toLowerCase();
    return this.snap.requests.filter(
      (r) =>
        (this.statusFilter === "all" ||
          (this.statusFilter === "ok" && r.status < 400) ||
          (this.statusFilter === "err" && r.status >= 400)) &&
        (ql === "" || `${r.path} ${r.method}`.toLowerCase().includes(ql)),
    );
  }

  private filteredFailed() {
    return this.activeTag === "all"
      ? this.snap.failedJobs
      : this.snap.failedJobs.filter((j) => j.tags.includes(this.activeTag));
  }

  private activeLabel(): string {
    if (this.tab === "route") return "Route detail";
    for (const g of NAV) for (const it of g.items) if (it.id === this.tab) return it.label;
    return MonitorPanel.find(this.tab)?.label ?? "Overview";
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  override async render(): Promise<HtmlNode> {
    if (!this.snap) {
      return <div class="grid h-screen place-items-center text-muted-foreground">Loading…</div>;
    }
    return (
      <div class="flex h-full">
        {this.renderSidebar()}
        <div class="flex-1 flex flex-col min-w-0">
          {this.renderTopbar()}
          <main class="flex-1 overflow-y-auto p-5 sm:p-7">
            {this.live ? (
              <div
                poll={{ every: `${Math.round(this.refreshMs / 1000)}s`, action: this.refreshData }}
                class="hidden"
              />
            ) : (
              ""
            )}
            {this.renderAlerts()}
            {this.tab === "overview" ? this.renderOverview() : ""}
            {this.tab === "requests" ? this.renderRequests() : ""}
            {this.tab === "route" ? this.renderRouteDetail() : ""}
            {this.tab === "realtime" ? this.renderRealtime() : ""}
            {this.tab === "exceptions" ? this.renderExceptions() : ""}
            {this.tab === "alerts" ? this.renderAlertsTab() : ""}
            {this.tab === "security" ? this.renderSecurity() : ""}
            {this.tab === "logs" ? this.renderLogs() : ""}
            {this.tab === "queues" ? this.renderQueues() : ""}
            {this.tab === "mail" ? this.renderMail() : ""}
            {this.tab === "notifications" ? this.renderNotifications() : ""}
            {this.tab === "database" ? this.renderDatabase() : ""}
            {this.tab === "cache" ? this.renderCache() : ""}
            {this.tab === "commands" ? this.renderCommands() : ""}
            {this.tab === "system" ? this.renderSystem() : ""}
            {MonitorPanel.find(this.tab) ? this.renderContributedSection() : ""}
          </main>
        </div>
      </div>
    );
  }

  // ── Contributed sections ────────────────────────────────────────────────────

  /**
   * Draw a section another package described.
   *
   * The contributor supplies stats and tables; the markup is the panel's, so a
   * contributed section is indistinguishable from a built-in one and a package
   * needs no JSX to add one.
   */
  private renderContributedSection(): HtmlNode {
    const data = this.sectionData;
    const stats = data?.stats ?? [];
    const tables = data?.tables ?? [];

    if (stats.length === 0 && tables.length === 0) {
      return (
        <Card class="p-12 text-center">
          <div class="text-sm font-medium text-muted-foreground">Nothing recorded yet</div>
          <div class="mt-1 text-xs text-muted-foreground">
            This section has no data for the selected range.
          </div>
        </Card>
      );
    }

    return (
      <section class="space-y-6">
        {stats.length > 0 ? (
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => this.renderSectionStat(s))}
          </div>
        ) : (
          ""
        )}
        {tables.map((t) => this.renderSectionTable(t))}
      </section>
    );
  }

  private renderSectionStat(s: MonitorStat): HtmlNode {
    return (
      <Card key={s.label} class="p-5">
        <div class="text-xs font-medium text-muted-foreground">{s.label}</div>
        <div class={["mt-2 text-3xl font-bold tabular", SECTION_TONE[s.tone ?? "default"]]}>
          {String(s.value)}
        </div>
        {s.percent !== undefined ? (
          <div class="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              class={["h-full transition-all", SECTION_BAR[s.tone ?? "default"]]}
              style={`width:${Math.max(0, Math.min(100, s.percent))}%`}
            />
          </div>
        ) : (
          ""
        )}
        {s.detail ? (
          <div class="mt-2 text-[11px] text-muted-foreground tabular">{s.detail}</div>
        ) : (
          ""
        )}
      </Card>
    );
  }

  private renderSectionTable(t: MonitorTable): HtmlNode {
    // Rendered with flow-ui's Table so a contributed section gets the same
    // sorting affordances, row keys and hover behaviour as every other table
    // Zerotal ships — the contributor describes columns, the kit draws them.
    const columns: TableColumn[] = t.columns.map((c) => ({
      key: c.key,
      label: c.label,
      class: [
        c.align === "end" ? "text-right tabular" : "text-left",
        c.mono ? "font-mono text-xs" : "",
      ]
        .filter(Boolean)
        .join(" "),
      render: (row: MonitorRow) => {
        const raw = row[c.key];
        const text = c.format
          ? c.format(raw, row)
          : raw === null || raw === undefined
            ? "—"
            : String(raw);
        const tone = c.tone?.(raw, row) ?? null;
        return tone ? <span class={SECTION_TONE[tone]}>{text}</span> : text;
      },
    }));

    return (
      <Card key={t.title} class="overflow-hidden">
        <CardHeader class="border-b p-0">
          <CardTitle class="px-5 py-3 text-sm font-semibold">{t.title}</CardTitle>
        </CardHeader>
        {t.rows.length === 0 ? (
          <div class="px-5 py-10 text-center text-sm text-muted-foreground">
            {t.empty ?? "Nothing to show."}
          </div>
        ) : (
          <div class="overflow-x-auto">
            <Table columns={columns} rows={t.rows} hover />
          </div>
        )}
      </Card>
    );
  }

  // ── Sidebar ─────────────────────────────────────────────────────────────────

  private renderSidebar(): HtmlNode {
    return (
      <aside class="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-card">
        <div class="flex items-center gap-2.5 px-5 h-16 border-b border-border">
          <div
            class="grid place-items-center w-9 h-9 rounded-[10px] text-primary-foreground shrink-0"
            style="background:linear-gradient(135deg,hsl(var(--primary)),hsl(var(--primary)/0.75));box-shadow:0 2px 8px hsl(var(--primary)/0.35)"
          >
            <span
              class="w-[18px] h-[18px] block"
              dangerouslySetInnerHTML={{ __html: icons.logo! }}
            />
          </div>
          <div class="leading-tight">
            <div class="font-extrabold text-foreground text-[15px] tracking-tight">
              {this.brandTitle}
            </div>
            <div class="font-mono text-[10px] text-primary/80">v1.1 · {this.brandSubtitle}</div>
          </div>
        </div>

        <nav class="flex-1 overflow-y-auto p-3 space-y-4">
          {this._navGroups().map((grp) => (
            <div key={grp.label}>
              <div class="px-3 mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {grp.label}
              </div>
              <div class="space-y-0.5">
                {grp.items.map((item) => {
                  const active = this.tab === item.id;
                  const badgeCount = item.badge ? this.badge(item.badge) : 0;
                  return (
                    <a
                      key={item.id}
                      navigate
                      href={this._sectionHref(item.id)}
                      class={[
                        "group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-colors",
                        active
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-muted-foreground hover:bg-accent",
                      ]}
                    >
                      <span
                        class={[
                          "w-5 h-5 shrink-0 block",
                          active
                            ? "text-primary"
                            : "text-muted-foreground group-hover:text-foreground",
                        ]}
                        dangerouslySetInnerHTML={{ __html: item.icon }}
                      />
                      <span>{item.label}</span>
                      {item.badge && badgeCount ? (
                        <span
                          class={[
                            "ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                            item.badgeTone === "red"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-muted text-muted-foreground",
                          ]}
                        >
                          {badgeCount}
                        </span>
                      ) : (
                        <span
                          class={[
                            "ml-auto w-1.5 h-1.5 rounded-full transition-colors",
                            active ? "bg-primary" : "bg-muted",
                          ]}
                        />
                      )}
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    );
  }

  // ── Topbar ────────────────────────────────────────────────────────────────

  private renderTopbar(): HtmlNode {
    const env = this.snap.meta.environment;
    const isProd = /^prod/i.test(env);
    const allOk = this.snap.health.every((h) => h.ok);
    return (
      <header class="h-16 shrink-0 flex items-center gap-4 px-5 sm:px-7 border-b border-border bg-card/80 backdrop-blur">
        <h1 class="text-lg font-bold text-foreground tracking-tight">{this.activeLabel()}</h1>
        <span
          class={[
            "hidden sm:inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border",
            isProd
              ? "bg-success/10 text-success border-success/30"
              : "bg-warning/10 text-warning border-warning/30",
          ]}
        >
          <span class={["w-1.5 h-1.5 rounded-full", isProd ? "bg-success" : "bg-warning"]} /> {env}
        </span>
        <span
          class={[
            "hidden md:inline-flex items-center gap-1.5 text-xs font-medium",
            allOk ? "text-success" : "text-destructive",
          ]}
        >
          <span class="relative flex h-2 w-2">
            <span
              class={[
                "absolute inline-flex h-full w-full rounded-full opacity-75",
                allOk ? "bg-success/80 animate-ping" : "bg-destructive/80",
              ]}
            />
            <span
              class={[
                "relative inline-flex rounded-full h-2 w-2",
                allOk ? "bg-success" : "bg-destructive",
              ]}
            />
          </span>
          {allOk ? "All systems operational" : "Degraded"}
        </span>

        <div class="ml-auto flex items-center gap-3">
          <span class="text-xs text-muted-foreground hidden lg:inline">
            {this.live ? `auto-refresh ${Math.round(this.refreshMs / 1000)}s` : "paused"}
          </span>

          <div class="hidden sm:flex items-center p-0.5 rounded-lg bg-muted border border-border">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => this.setRange(r)}
                class={[
                  "px-2.5 py-1 rounded-md text-xs font-semibold transition-colors capitalize",
                  this.range === r
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                ]}
              >
                {r}
              </button>
            ))}
          </div>

          <button
            onClick={this.toggleLive}
            class={[
              "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors",
              this.live
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-card border-border text-muted-foreground",
            ]}
          >
            <span class="relative flex h-2 w-2">
              <span
                class={[
                  "absolute inline-flex h-full w-full rounded-full bg-primary/80 opacity-75",
                  this.live ? "animate-ping" : "",
                ]}
              />
              <span
                class={[
                  "relative inline-flex rounded-full h-2 w-2",
                  this.live ? "bg-primary" : "bg-muted-foreground/40",
                ]}
              />
            </span>
            <span>{this.live ? "Live" : "Paused"}</span>
          </button>

          <button
            onClick={this.refreshData}
            title="Refresh"
            class="grid place-items-center w-9 h-9 rounded-lg border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              class="w-4 h-4"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M16.5 9a6.5 6.5 0 1 0-1.2 4.5" />
              <path d="M16.5 3.5V9H11" />
            </svg>
          </button>

          <div class="w-px h-6 bg-muted mx-1 hidden sm:block" />
          <div
            class="grid place-items-center w-8 h-8 rounded-full text-primary-foreground text-[11px] font-bold shrink-0"
            style="background:linear-gradient(135deg,hsl(var(--primary)),hsl(var(--primary)/0.75))"
            title="Operator · Admin"
          >
            SM
          </div>
        </div>
      </header>
    );
  }

  // ── Alerts banner ─────────────────────────────────────────────────────────

  private renderAlerts(): HtmlNode {
    const alerts = this.snap.alerts;
    const visible = alerts.filter((_, i) => !this.dismissed.includes(i));
    if (visible.length === 0) return <span />;
    return (
      <div class="space-y-2 mb-5">
        {alerts.map((a, i) =>
          this.dismissed.includes(i) ? (
            ""
          ) : (
            <div
              key={i}
              class={[
                "flex items-start gap-3 px-4 py-2.5 rounded-lg border text-sm",
                a.tone === "red"
                  ? "bg-destructive/10 border-destructive/30 text-destructive"
                  : "bg-warning/10 border-warning/30 text-warning",
              ]}
            >
              <span
                class={[
                  "mt-1.5 w-1.5 h-1.5 rounded-full shrink-0",
                  a.tone === "red" ? "bg-destructive" : "bg-warning",
                ]}
              />
              <span class="flex-1">{a.text}</span>
              <button
                onClick={() => this.dismissAlert(i)}
                class="shrink-0 opacity-60 hover:opacity-100 text-xs font-bold"
              >
                ✕
              </button>
            </div>
          ),
        )}
      </div>
    );
  }

  // ── Overview ────────────────────────────────────────────────────────────────

  /** One card in the Overview live-pulse row: a status dot, a label, a big number, a sub-line. */
  private _pulseCard(
    label: string,
    value: string,
    sub: string,
    pulsing: boolean,
    danger = false,
  ): HtmlNode {
    return (
      <Card class="p-4">
        <div class="flex items-center gap-2">
          <span class="relative flex h-2 w-2">
            {pulsing ? (
              <span
                class={[
                  "absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping",
                  danger ? "bg-destructive/80" : "bg-success/80",
                ]}
              />
            ) : (
              ""
            )}
            <span
              class={[
                "relative inline-flex rounded-full h-2 w-2",
                danger ? "bg-destructive" : pulsing ? "bg-success" : "bg-muted-foreground/40",
              ]}
            />
          </span>
          <span class="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <div
          class={[
            "mt-1.5 text-3xl font-bold tabular font-mono",
            danger ? "text-destructive" : "text-foreground",
          ]}
        >
          {value}
        </div>
        <div class="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
      </Card>
    );
  }

  private renderOverview(): HtmlNode {
    const s = this.snap;
    const p = s.pulse;
    const pct = (label: string): number => s.percentiles.find((x) => x.label === label)?.value ?? 0;
    const p99 = Math.max(1, pct("p99"));
    const tp = areaPaths(s.throughput, 720, 180);
    return (
      <section class="space-y-6">
        {/* Row 1 · Live pulse — what's happening right now */}
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {this._pulseCard(
            "Active requests",
            commas(p.activeRequests),
            "processing now",
            p.activeRequests > 0,
          )}
          {this._pulseCard(
            "WS connections",
            commas(p.activeConnections),
            "open sockets",
            p.activeConnections > 0,
          )}
          {this._pulseCard(
            "Requests / sec",
            String(p.requestsPerSec),
            "last 5 min",
            p.requestsPerSec > 0,
          )}
          {this._pulseCard(
            "Error rate",
            `${p.errorRatePct}%`,
            "last 5 min",
            false,
            p.errorRatePct > 1,
          )}
        </div>

        {/* Row 2 · Performance & health */}
        <div class="grid lg:grid-cols-3 gap-4">
          <Card class="p-5">
            <div class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Latency profile
            </div>
            <div class="space-y-2.5">
              {(["p50", "p95", "p99"] as const).map((label) => {
                const v = pct(label);
                return (
                  <div key={label} class="flex items-center gap-3">
                    <span class="text-[11px] font-mono text-muted-foreground w-8 shrink-0">
                      {label}
                    </span>
                    <div class="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        class={[
                          "h-full rounded-full",
                          v > 500 ? "bg-destructive" : v > 200 ? "bg-warning" : "bg-primary",
                        ]}
                        style={`width:${Math.min(100, Math.round((v / p99) * 100))}%`}
                      />
                    </div>
                    <span
                      class={["tabular font-semibold text-sm w-14 text-right shrink-0", pctTone(v)]}
                    >
                      {v}ms
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card class="p-5">
            <div class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              System health
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <div
                  class={[
                    "text-2xl font-bold tabular font-mono",
                    s.apdex >= 0.94
                      ? "text-success"
                      : s.apdex >= 0.85
                        ? "text-warning"
                        : "text-destructive",
                  ]}
                >
                  {s.apdex.toFixed(2)}
                </div>
                <div class="text-[11px] text-muted-foreground mt-0.5">Apdex score</div>
              </div>
              <div>
                <div
                  class={[
                    "text-2xl font-bold tabular font-mono",
                    s.cache.hitRate >= 90
                      ? "text-success"
                      : s.cache.hitRate >= 70
                        ? "text-warning"
                        : "text-muted-foreground",
                  ]}
                >
                  {s.cache.hitRate}%
                </div>
                <div class="text-[11px] text-muted-foreground mt-0.5">Cache hit rate</div>
              </div>
            </div>
          </Card>

          <Card class="p-5">
            <div class="flex items-center justify-between mb-3">
              <span class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Busiest components
              </span>
              <a
                navigate
                href={this._sectionHref("realtime")}
                class="text-[11px] font-semibold text-primary hover:text-primary"
              >
                Realtime →
              </a>
            </div>
            <div class="space-y-1.5">
              {s.realtime.components.length === 0 ? (
                <div class="text-xs text-muted-foreground py-2">no actions yet</div>
              ) : (
                s.realtime.components.slice(0, 3).map((c) => (
                  <div key={c.name} class="flex items-center gap-2 text-sm">
                    <span class="font-mono text-xs text-muted-foreground truncate flex-1">
                      {c.name}
                    </span>
                    <span class="tabular text-[11px] text-muted-foreground shrink-0">
                      {c.avgMs}ms
                    </span>
                    <span class="tabular text-xs font-semibold text-foreground w-8 text-right shrink-0">
                      {commas(c.actions)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <Card class="p-5">
          <div class="flex items-center justify-between mb-3">
            <div>
              <h3 class="font-semibold text-foreground">Throughput</h3>
              <p class="text-xs text-muted-foreground">
                HTTP requests + WebSocket actions · {this.range}
              </p>
            </div>
            <div class="flex items-center gap-4 text-xs">
              <span class="flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-sm bg-primary" />
                HTTP requests
              </span>
              <span class="flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-sm bg-primary" />
                WebSocket actions
              </span>
              <span class="flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-sm bg-muted-foreground/40" />
                jobs
              </span>
              <span class="flex items-center gap-1.5">
                <span class="inline-block w-0 h-3 border-l border-dashed border-foreground" />
                deploy
              </span>
            </div>
          </div>
          <svg class="w-full h-44" viewBox="0 0 720 180" preserveAspectRatio="none">
            <defs>
              <linearGradient id="mon-g" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="hsl(var(--primary))" stop-opacity="0.25" />
                <stop offset="100%" stop-color="hsl(var(--primary))" stop-opacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1="45" x2="720" y2="45" stroke="hsl(var(--border))" stroke-width="1" />
            <line x1="0" y1="90" x2="720" y2="90" stroke="hsl(var(--border))" stroke-width="1" />
            <line x1="0" y1="135" x2="720" y2="135" stroke="hsl(var(--border))" stroke-width="1" />
            <path d={tp.area} fill="url(#mon-g)" />
            <path
              d={tp.line}
              fill="none"
              stroke="hsl(var(--primary))"
              stroke-width="2.5"
              vector-effect="non-scaling-stroke"
              stroke-linejoin="round"
            />
            <path
              d={areaPaths(s.jobsSeries, 720, 180).line}
              fill="none"
              stroke="hsl(var(--muted-foreground) / 0.4)"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
              stroke-linejoin="round"
            />
            <path
              d={areaPaths(s.realtime.series, 720, 180).line}
              fill="none"
              stroke="hsl(var(--chart-3))"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
              stroke-linejoin="round"
              opacity="0.9"
            />
            {s.deploys.map((d) => (
              <line
                key={d.sha}
                x1={((d.at / 60) * 720).toFixed(0)}
                x2={((d.at / 60) * 720).toFixed(0)}
                y1="0"
                y2="180"
                stroke="hsl(var(--foreground))"
                stroke-width="1.2"
                stroke-dasharray="3 3"
                opacity="0.4"
                vector-effect="non-scaling-stroke"
              />
            ))}
          </svg>
          <div class="flex flex-wrap gap-2 mt-3">
            {s.deploys.map((d) => (
              <span
                key={d.sha}
                class="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-md bg-muted text-muted-foreground"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>deploy {d.sha}</span>
                <span class="text-muted-foreground">{d.when}</span>
              </span>
            ))}
          </div>
        </Card>

        <div>
          <h3 class="text-sm font-bold text-foreground mb-3">System bottlenecks</h3>
          <div class="grid lg:grid-cols-3 gap-6">
            <Card class="overflow-hidden">
              <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm flex items-center justify-between">
                <span>Slowest routes</span>
                <span class="text-[11px] text-muted-foreground font-normal">drill in</span>
              </div>
              <div class="divide-y divide-border">
                {s.slowRoutes.map((r) => (
                  <button
                    key={r.path + r.method}
                    onClick={() => this.openRoute(r.method, r.path)}
                    class="w-full flex items-center gap-3 px-5 py-2.5 text-sm text-left hover:bg-accent transition-colors"
                  >
                    <span
                      class={["text-[10px] font-bold px-1.5 py-0.5 rounded", methodTone(r.method)]}
                    >
                      {r.method}
                    </span>
                    <span class="font-mono text-xs text-muted-foreground truncate">{r.path}</span>
                    <span
                      class={[
                        "ml-auto tabular font-semibold",
                        r.ms > 500
                          ? "text-destructive"
                          : r.ms > 200
                            ? "text-warning"
                            : "text-muted-foreground",
                      ]}
                    >
                      {r.ms}ms
                    </span>
                  </button>
                ))}
              </div>
            </Card>

            <Card>
              <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
                Top exceptions
              </div>
              <div class="divide-y divide-border">
                {s.exceptions.length === 0 ? (
                  <div class="px-5 py-8 text-center text-xs text-muted-foreground">none 🎉</div>
                ) : (
                  s.exceptions.slice(0, 5).map((e) => (
                    <div key={e.type} class="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <span class="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                      <span class="font-mono text-xs text-foreground truncate flex-1">
                        {e.type}
                      </span>
                      {e.users > 0 ? (
                        <span class="tabular text-[11px] text-muted-foreground shrink-0">
                          {commas(e.users)} usr
                        </span>
                      ) : (
                        ""
                      )}
                      <span class="ml-auto tabular text-xs font-bold text-destructive shrink-0">
                        {e.count}×
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card class="overflow-hidden">
              <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm flex items-center justify-between">
                <span>Slow outgoing HTTP</span>
                <span class="text-[11px] text-muted-foreground font-normal">p95</span>
              </div>
              <div class="divide-y divide-border">
                {s.outgoingHttp.length === 0 ? (
                  <div class="px-5 py-8 text-center text-xs text-muted-foreground">
                    no third-party calls
                  </div>
                ) : (
                  s.outgoingHttp.slice(0, 5).map((h) => (
                    <div key={h.host} class="flex items-center gap-2 px-5 py-2.5 text-sm">
                      <span class="font-mono text-xs text-foreground truncate flex-1">
                        {h.host}
                      </span>
                      <span class="tabular text-[11px] text-muted-foreground shrink-0">
                        {h.calls.toLocaleString()}
                      </span>
                      <span
                        class={[
                          "tabular font-semibold text-xs w-14 text-right shrink-0",
                          pctTone(h.p95),
                        ]}
                      >
                        {h.p95}ms
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      </section>
    );
  }

  // ── Queues ────────────────────────────────────────────────────────────────

  private renderQueues(): HtmlNode {
    const s = this.snap;
    const failed = this.filteredFailed();
    return (
      <section class="space-y-6">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {s.queueStats.map((m) => (
            <div key={m.label} class="rounded-xl bg-card border border-border p-4 shadow-sm">
              <div class="text-xs font-medium text-muted-foreground">{m.label}</div>
              <div class={["mt-1.5 text-2xl font-bold tabular font-mono", toneText(m.tone)]}>
                {m.value}
              </div>
              <div class="text-[11px] text-muted-foreground mt-0.5">{m.sub}</div>
            </div>
          ))}
        </div>

        <Card class="overflow-hidden">
          <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
            Workers
          </div>
          <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-muted">
            {s.workers.map((w) => (
              <div key={w.name} class="bg-card p-4">
                <div class="flex items-center justify-between">
                  <span class="font-mono text-xs font-semibold text-foreground">{w.name}</span>
                  <span
                    class={[
                      "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                      w.status === "running"
                        ? "bg-success/10 text-success"
                        : w.status === "paused"
                          ? "bg-warning/10 text-warning"
                          : "bg-muted text-muted-foreground",
                    ]}
                  >
                    {w.status}
                  </span>
                </div>
                <div class="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    <span class="font-semibold text-foreground tabular">{w.processes}</span> procs
                  </span>
                  <span>
                    <span class="font-semibold text-foreground tabular">{w.jobsPerMin}</span>/min
                  </span>
                </div>
                <Sparkline
                  series={w.series.length ? w.series : [0, 0]}
                  stroke="hsl(var(--muted-foreground))"
                  class="mt-2 w-full h-6"
                />
              </div>
            ))}
          </div>
        </Card>

        <Card class="overflow-hidden">
          <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm flex items-center justify-between">
            <span>Queues</span>
            <span class="text-xs text-muted-foreground font-normal">depth · wait · throughput</span>
          </div>
          <table class="w-full text-sm">
            <thead class="text-left text-[11px] uppercase tracking-wide text-muted-foreground bg-muted">
              <tr>
                <th class="px-5 py-2 font-medium">Queue</th>
                <th class="px-3 py-2 font-medium">Pending</th>
                <th class="px-3 py-2 font-medium">Wait</th>
                <th class="px-3 py-2 font-medium">Throughput</th>
                <th class="px-3 py-2 font-medium">Trend</th>
                <th class="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {s.queues.map((q) => (
                <tr key={q.name} class="hover:bg-accent/60">
                  <td class="px-5 py-2.5 font-mono text-xs text-foreground font-medium">
                    <span>{q.name}</span>
                    {q.paused ? (
                      <span class="ml-2 text-[9px] font-bold px-1 py-0.5 rounded bg-warning/20 text-warning uppercase">
                        paused
                      </span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td
                    class={[
                      "px-3 py-2.5 tabular",
                      q.pending > 200 ? "text-destructive font-semibold" : "text-muted-foreground",
                    ]}
                  >
                    {q.pending}
                  </td>
                  <td class="px-3 py-2.5 tabular text-muted-foreground">{q.wait}s</td>
                  <td class="px-3 py-2.5 tabular text-muted-foreground">{q.throughput}/min</td>
                  <td class="px-3 py-2.5 w-32">
                    <Sparkline series={q.series.length ? q.series : [0, 0]} class="w-24 h-5" />
                  </td>
                  <td class="px-3 py-2.5 text-right">
                    <button
                      onClick={() => this.pauseQueue(q.name)}
                      class={[
                        "text-[11px] font-semibold px-2 py-1 rounded-md border transition-colors",
                        q.paused
                          ? "border-warning/40 text-warning bg-warning/10"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary",
                      ]}
                    >
                      {q.paused ? "Resume" : "Pause"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card class="overflow-hidden">
          <div class="px-5 py-3 border-b border-border flex flex-wrap items-center gap-2">
            <span class="font-semibold text-foreground text-sm">Failed jobs</span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive">
              {failed.length}
            </span>
            <div class="ml-auto flex items-center gap-1">
              {s.jobTags.map((t) => (
                <button
                  key={t}
                  onClick={() => this.setTag(t)}
                  class={[
                    "text-[11px] font-semibold px-2 py-1 rounded-md capitalize transition-colors",
                    this.activeTag === t
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent",
                  ]}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div class="divide-y divide-border">
            {failed.map((j) => (
              <div key={j.id} class="flex items-center gap-3 px-5 py-3 text-sm">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-xs font-semibold text-foreground truncate">
                      {j.name}
                    </span>
                    {j.tags.map((tg) => (
                      <span
                        key={tg}
                        class="text-[9px] font-bold px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase"
                      >
                        {tg}
                      </span>
                    ))}
                    <span class="text-[10px] text-muted-foreground whitespace-nowrap">
                      attempt {j.attempts}
                    </span>
                  </div>
                  <div class="text-[11px] text-destructive truncate">{j.error}</div>
                </div>
                <span class="ml-auto text-[11px] text-muted-foreground tabular whitespace-nowrap">
                  {j.failedAt}
                </span>
                <button
                  onClick={() => this.retryJob(j.id)}
                  class="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                >
                  Retry
                </button>
              </div>
            ))}
            {failed.length === 0 ? (
              <div class="px-5 py-8 text-center text-sm text-muted-foreground">
                No failed jobs for this tag 🎉
              </div>
            ) : (
              ""
            )}
          </div>
        </Card>

        <div class="grid lg:grid-cols-2 gap-6">
          <Card class="overflow-hidden">
            <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
              Scheduled / delayed
            </div>
            <div class="divide-y divide-border">
              {s.scheduledJobs.map((sj) => (
                <div key={sj.name} class="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span class="font-mono text-xs text-foreground truncate">{sj.name}</span>
                  <span class="text-[9px] font-bold px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                    {sj.tag}
                  </span>
                  <span class="ml-auto text-[11px] text-muted-foreground">
                    on <span class="font-mono">{sj.queue}</span>
                  </span>
                  <span class="text-xs font-semibold text-primary tabular w-14 text-right">
                    {sj.runsIn === "—" ? "—" : `in ${sj.runsIn}`}
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <Card class="overflow-hidden">
            <div class="px-5 py-3 border-b border-border text-sm flex items-center gap-2">
              <span class="font-semibold text-foreground">Dead-letter</span>
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {s.deadLetter.length}
              </span>
              <span class="ml-auto text-[11px] text-muted-foreground font-normal">
                exhausted all retries
              </span>
            </div>
            <div class="divide-y divide-border">
              {s.deadLetter.map((d) => (
                <div key={d.id} class="flex items-center gap-3 px-5 py-3 text-sm">
                  <div class="min-w-0">
                    <div class="font-mono text-xs font-semibold text-foreground truncate">
                      {d.name}
                    </div>
                    <div class="text-[11px] text-muted-foreground truncate">{d.error}</div>
                  </div>
                  <span class="ml-auto text-[10px] text-muted-foreground whitespace-nowrap">
                    {d.attempts} tries · {d.deadAt}
                  </span>
                  <button
                    onClick={() => this.requeueDead(d.id)}
                    class="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                  >
                    Requeue
                  </button>
                </div>
              ))}
              {s.deadLetter.length === 0 ? (
                <div class="px-5 py-8 text-center text-sm text-muted-foreground">
                  Dead-letter empty
                </div>
              ) : (
                ""
              )}
            </div>
          </Card>
        </div>

        <Card class="overflow-hidden">
          <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
            Slowest jobs
          </div>
          <div class="divide-y divide-border">
            {s.slowJobs.length === 0 ? (
              <div class="px-5 py-8 text-center text-xs text-muted-foreground">
                no job runs in range
              </div>
            ) : (
              s.slowJobs.map((j, i) => (
                <div key={i} class="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span
                    class={[
                      "w-2 h-2 rounded-full shrink-0",
                      j.status === "failed"
                        ? "bg-destructive"
                        : j.status === "retried"
                          ? "bg-warning"
                          : "bg-success",
                    ]}
                  />
                  <span class="font-mono text-xs text-foreground truncate flex-1">
                    {j.className}
                  </span>
                  <span class="text-[11px] text-muted-foreground shrink-0">{j.queue}</span>
                  <span class="tabular text-xs font-semibold text-muted-foreground shrink-0">
                    {j.ms}ms
                  </span>
                  <span class="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">
                    {j.when}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>
    );
  }

  // ── Requests (trace explorer) ───────────────────────────────────────────────

  private renderRequests(): HtmlNode {
    const all = this.filteredRequests();
    const totalPages = Math.max(1, Math.ceil(all.length / REQ_PER_PAGE));
    const page = Math.min(Math.max(0, this.reqPage), totalPages - 1);
    const start = page * REQ_PER_PAGE;
    const pageRows = all.slice(start, start + REQ_PER_PAGE);
    return (
      <section class="space-y-4">
        <div class="flex flex-wrap items-center gap-3">
          <div class="relative flex-1 min-w-[200px]">
            <svg
              class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
            >
              <circle cx="9" cy="9" r="6" />
              <path d="M14 14l3 3" stroke-linecap="round" />
            </svg>
            <input
              value={this.q}
              live
              type="text"
              placeholder="Filter by path or method…"
              class="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
            />
          </div>
          <div class="flex items-center p-0.5 rounded-lg bg-muted border border-border">
            {[
              ["all", "All"],
              ["ok", "2xx/3xx"],
              ["err", "4xx/5xx"],
            ].map((f) => (
              <button
                key={f[0]}
                onClick={() => this.setStatusFilter(f[0]!)}
                class={[
                  "px-2.5 py-1 rounded-md text-xs font-semibold transition-colors",
                  this.statusFilter === f[0]
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                ]}
              >
                {f[1]}
              </button>
            ))}
          </div>
        </div>

        {this.renderRequestMetrics()}

        <Card class="overflow-hidden">
          <div class="px-5 py-3 border-b border-border flex items-center justify-between">
            <span class="font-semibold text-foreground text-sm">
              Recent requests ·{" "}
              <span class="text-muted-foreground font-normal">{all.length} shown</span>
            </span>
            <span class="text-xs text-muted-foreground">click a row for its trace</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-[11px] uppercase tracking-wide text-muted-foreground bg-muted">
                <tr>
                  <th class="px-5 py-2 font-medium">Method</th>
                  <th class="px-3 py-2 font-medium">Path</th>
                  <th class="px-3 py-2 font-medium">Status</th>
                  <th class="px-3 py-2 font-medium">User</th>
                  <th class="px-3 py-2 font-medium">IP</th>
                  <th class="px-3 py-2 font-medium">Queries</th>
                  <th class="px-3 py-2 font-medium">Memory</th>
                  <th class="px-3 py-2 font-medium">Time</th>
                  <th class="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {pageRows.length === 0 ? (
                  <tr>
                    <td colspan="9" class="px-5 py-10 text-center text-sm text-muted-foreground">
                      no requests in this range
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => this.renderRequestRows(r))
                )}
              </tbody>
            </table>
          </div>
          {all.length > 0 ? (
            <div class="px-5 py-2.5 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <span class="tabular">
                {start + 1}–{Math.min(start + REQ_PER_PAGE, all.length)} of {all.length}
              </span>
              <div class="flex items-center gap-1">
                <button
                  onClick={this.prevReqPage}
                  class={[
                    "px-2.5 py-1 rounded-md border text-xs font-semibold transition-colors",
                    page === 0
                      ? "border-border text-muted-foreground cursor-not-allowed"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary",
                  ]}
                >
                  Prev
                </button>
                <span class="px-2 tabular text-muted-foreground">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={this.nextReqPage}
                  class={[
                    "px-2.5 py-1 rounded-md border text-xs font-semibold transition-colors",
                    page >= totalPages - 1
                      ? "border-border text-muted-foreground cursor-not-allowed"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary",
                  ]}
                >
                  Next
                </button>
              </div>
            </div>
          ) : (
            ""
          )}
        </Card>
      </section>
    );
  }

  /** Format a memory figure (KB) as KB/MB, or "—" when unknown. */
  private _fmtMem(kb: number): string {
    if (!kb || kb <= 0) return "—";
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
  }

  /** Render `Monitor.context()` metadata as key=value chips. */
  private _contextChips(context: Record<string, unknown>): HtmlNode {
    return (
      <span class="flex flex-wrap items-center gap-1.5">
        {Object.entries(context).map(([k, v]) => (
          <span
            key={k}
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium"
          >
            <span class="text-primary/80">{k}</span>
            <span class="font-mono">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
          </span>
        ))}
      </span>
    );
  }

  /** Slow requests, application usage (top users), and top-memory routes. */
  private renderRequestMetrics(): HtmlNode {
    const s = this.snap;
    const maxUser = Math.max(1, ...s.topUsers.map((u) => u.requests));
    const maxMem = Math.max(1, ...s.topMemory.map((m) => m.memKb));
    return (
      <div class="grid lg:grid-cols-3 gap-4">
        {/* Slow requests */}
        <Card class="overflow-hidden">
          <div class="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span class="text-sm font-semibold text-foreground">Slow requests</span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive">
              {s.slowRequests.length}
            </span>
          </div>
          <div class="divide-y divide-border max-h-56 overflow-y-auto">
            {s.slowRequests.length === 0 ? (
              <div class="px-4 py-6 text-center text-xs text-muted-foreground">
                none over threshold
              </div>
            ) : (
              s.slowRequests.map((r) => (
                <button
                  key={`sr${r.id}`}
                  onClick={() => this.openReq(r.id)}
                  class="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-accent"
                >
                  <span
                    class={[
                      "text-[9px] font-bold px-1 py-0.5 rounded shrink-0",
                      methodTone(r.method),
                    ]}
                  >
                    {r.method}
                  </span>
                  <span class="font-mono text-[11px] text-muted-foreground truncate flex-1">
                    {r.path}
                  </span>
                  <span class="tabular text-xs font-semibold text-destructive shrink-0">
                    {r.ms}ms
                  </span>
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Application usage — top users */}
        <Card class="overflow-hidden">
          <div class="px-4 py-2.5 border-b border-border">
            <span class="text-sm font-semibold text-foreground">Application usage</span>
            <span class="text-[11px] text-muted-foreground ml-1">· top users</span>
          </div>
          <div class="divide-y divide-border max-h-56 overflow-y-auto">
            {s.topUsers.length === 0 ? (
              <div class="px-4 py-6 text-center text-xs text-muted-foreground">
                no authenticated traffic
              </div>
            ) : (
              s.topUsers.map((u) => (
                <div key={u.id} class="flex items-center gap-3 px-4 py-2">
                  <span class="font-mono text-[11px] text-muted-foreground truncate flex-1">
                    {u.id}
                  </span>
                  <div class="w-20 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                    <div
                      class="h-full bg-primary/80"
                      style={`width:${Math.round((u.requests / maxUser) * 100)}%`}
                    />
                  </div>
                  <span class="tabular text-xs font-semibold text-foreground w-10 text-right shrink-0">
                    {commas(u.requests)}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Top memory routes */}
        <Card class="overflow-hidden">
          <div class="px-4 py-2.5 border-b border-border">
            <span class="text-sm font-semibold text-foreground">Top memory</span>
            <span class="text-[11px] text-muted-foreground ml-1">· peak heap / route</span>
          </div>
          <div class="divide-y divide-border max-h-56 overflow-y-auto">
            {s.topMemory.length === 0 ? (
              <div class="px-4 py-6 text-center text-xs text-muted-foreground">no data yet</div>
            ) : (
              s.topMemory.map((m) => (
                <div key={`${m.method}${m.path}`} class="flex items-center gap-2 px-4 py-2">
                  <span class="font-mono text-[11px] text-muted-foreground truncate flex-1">
                    {m.path}
                  </span>
                  <span
                    class={[
                      "tabular text-xs font-semibold shrink-0",
                      m.memKb >= maxMem * 0.8 ? "text-warning" : "text-muted-foreground",
                    ]}
                  >
                    {this._fmtMem(m.memKb)}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    );
  }

  private renderRequestRows(r: RequestEntry): HtmlNode[] {
    const open = this.openRequestId === r.id;
    const rows: HtmlNode[] = [
      <tr
        key={`r${r.id}`}
        class="hover:bg-accent/60 cursor-pointer"
        onClick={() => this.openReq(r.id)}
      >
        <td class="px-5 py-2.5">
          <span class={["text-[10px] font-bold px-1.5 py-0.5 rounded", methodTone(r.method)]}>
            {r.method}
          </span>
        </td>
        <td class="px-3 py-2.5 font-mono text-xs text-foreground truncate max-w-[220px]">
          {r.path}
        </td>
        <td class="px-3 py-2.5">
          <span class={["tabular font-semibold", statusTone(r.status)]}>{r.status}</span>
        </td>
        <td class="px-3 py-2.5 text-xs text-muted-foreground truncate max-w-[140px]">
          {r.user ?? "—"}
        </td>
        <td class="px-3 py-2.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
          {r.ip ?? "—"}
        </td>
        <td class="px-3 py-2.5 tabular text-muted-foreground">
          {r.queries.length}
          {r.nplus ? <span class="ml-1 text-[10px] font-bold text-destructive">N+1</span> : ""}
        </td>
        <td class="px-3 py-2.5 tabular text-xs text-muted-foreground whitespace-nowrap">
          {this._fmtMem(r.memKb)}
        </td>
        <td
          class={[
            "px-3 py-2.5 tabular",
            r.ms > 500 ? "text-destructive" : r.ms > 200 ? "text-warning" : "text-muted-foreground",
          ]}
        >
          {r.ms}ms
        </td>
        <td class="px-3 py-2.5 text-[11px] text-muted-foreground tabular whitespace-nowrap">
          {r.when}
        </td>
      </tr>,
    ];
    if (open) {
      rows.push(
        <tr key={`d${r.id}`}>
          <td colspan="9" class="px-5 pb-4 pt-1 bg-muted/50">
            <div class="flex flex-wrap items-center gap-x-6 gap-y-1 px-1 py-2 text-[11px] text-muted-foreground">
              <span>
                user <span class="font-mono text-foreground">{r.user ?? "guest"}</span>
              </span>
              <span>
                ip <span class="font-mono text-foreground">{r.ip ?? "—"}</span>
              </span>
              <span>
                memory <span class="font-mono text-foreground">{this._fmtMem(r.memKb)}</span>
              </span>
              {Object.keys(r.context).length > 0 ? this._contextChips(r.context) : ""}
              <button
                onClick={() => this.openRoute(r.method, r.path)}
                class="ml-auto font-semibold text-primary hover:text-primary"
              >
                View route history →
              </button>
            </div>
            {r.error ? (
              <div class="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-2.5 mb-2 flex items-start gap-2">
                <span class="mt-0.5 w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                <span class="font-mono text-[11px] text-destructive break-all">{r.error}</span>
              </div>
            ) : (
              ""
            )}
            <div class="rounded-lg bg-card border border-border p-4 mb-2">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-semibold text-foreground">Trace waterfall</span>
                <span class="text-[11px] text-muted-foreground tabular">total {r.ms}ms</span>
              </div>
              <div class="space-y-1">
                {r.spans.map((sp, si) => (
                  <div key={si} class="flex items-center gap-2 text-[11px]">
                    <span class="w-36 shrink-0 font-mono text-muted-foreground truncate">
                      {sp.label}
                    </span>
                    <div class="relative flex-1 h-3.5 rounded bg-muted">
                      <div
                        class="absolute top-0 h-3.5 rounded"
                        style={`left:${((sp.start / r.ms) * 100).toFixed(1)}%;width:${Math.max(1.5, (sp.dur / r.ms) * 100).toFixed(1)}%;background:${spanColor(sp.kind)}`}
                      />
                    </div>
                    <span class="w-12 shrink-0 text-right tabular text-muted-foreground">
                      {sp.dur}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div class="rounded-lg bg-foreground p-4 font-mono text-[11px] text-muted-foreground space-y-1 overflow-x-auto">
              <div class="text-muted-foreground">— SQL queries ({r.queries.length}) —</div>
              {r.queries.map((q, qi) => (
                <div key={qi} class="flex gap-3">
                  <span class="text-primary/80 shrink-0 tabular">{q.ms}ms</span>
                  <span class="text-muted-foreground truncate">{q.sql}</span>
                </div>
              ))}
              {r.queries.length === 0 ? <div class="text-muted-foreground">no queries</div> : ""}
              <div class="text-muted-foreground pt-2">— log —</div>
              {r.logs.map((l, li) => (
                <div key={li}>
                  <span
                    class={
                      l.level === "error"
                        ? "text-destructive/80"
                        : l.level === "warn"
                          ? "text-warning/80"
                          : "text-success/80"
                    }
                  >
                    [{l.level}]
                  </span>{" "}
                  <span class="text-muted-foreground">{l.msg}</span>
                </div>
              ))}
            </div>
            {r.payload ? this._renderPayload(r.payload) : ""}
          </td>
        </tr>,
      );
    }
    return rows;
  }

  /** Captured request/response headers + bodies (when payload capture is enabled). */
  private _renderPayload(p: import("../store/types.ts").RequestPayload): HtmlNode {
    const box = "rounded-lg bg-card border border-border overflow-hidden";
    const head =
      "px-3 py-1.5 text-[11px] font-semibold text-muted-foreground border-b border-border";
    const body =
      "p-3 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-all max-h-44 overflow-y-auto";
    return (
      <div class="mt-2 grid lg:grid-cols-3 gap-2">
        <div class={box}>
          <div class={head}>Request headers</div>
          <div class="p-3 font-mono text-[11px] text-muted-foreground space-y-0.5 max-h-44 overflow-y-auto">
            {Object.entries(p.reqHeaders).map(([k, v]) => (
              <div key={k} class="flex gap-2">
                <span class="text-muted-foreground shrink-0">{k}:</span>
                <span class="truncate">{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div class={box}>
          <div class={head}>Request body</div>
          <pre class={body}>{p.reqBody || "—"}</pre>
        </div>
        <div class={box}>
          <div class={head}>Response body</div>
          <pre class={body}>{p.resBody || "—"}</pre>
        </div>
      </div>
    );
  }

  // ── Route detail (per-route drill-in) ───────────────────────────────────────

  /** Tailwind classes colouring one status-class bar. */
  private _statusClassTone(label: string): string {
    return label === "2xx"
      ? "bg-success"
      : label === "3xx"
        ? "bg-muted-foreground"
        : label === "4xx"
          ? "bg-warning"
          : "bg-destructive";
  }

  /** One compact request row in the route-detail recent/slowest lists. */
  private _routeReqRow(r: RequestEntry, key: string): HtmlNode {
    return (
      <div key={key} class="flex items-center gap-3 px-5 py-2 text-sm">
        <span class={["tabular font-semibold w-10 shrink-0", statusTone(r.status)]}>
          {r.status}
        </span>
        <span class="text-xs text-muted-foreground truncate flex-1">{r.user ?? "guest"}</span>
        <span class="font-mono text-[11px] text-muted-foreground shrink-0 hidden sm:inline">
          {r.ip ?? "—"}
        </span>
        <span
          class={[
            "tabular text-xs font-semibold w-14 text-right shrink-0",
            r.ms > 500 ? "text-destructive" : r.ms > 200 ? "text-warning" : "text-muted-foreground",
          ]}
        >
          {r.ms}ms
        </span>
        <span class="text-[11px] text-muted-foreground tabular w-16 text-right shrink-0 whitespace-nowrap">
          {r.when}
        </span>
      </div>
    );
  }

  private renderRouteDetail(): HtmlNode {
    const d = this.routeDetail;
    if (!d) {
      return (
        <div class="grid place-items-center py-20 text-muted-foreground text-sm">
          Loading route…
        </div>
      );
    }
    const maxStatus = Math.max(1, ...d.statusDist.map((s) => s.count));
    return (
      <section class="space-y-6">
        <div class="flex items-center gap-3 flex-wrap">
          <button
            onClick={this.backFromRoute}
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
          >
            ← Back
          </button>
          <span class={["text-[11px] font-bold px-2 py-1 rounded", methodTone(d.method)]}>
            {d.method}
          </span>
          <span class="font-mono text-sm text-foreground truncate">{d.path}</span>
          <span class="text-[11px] text-muted-foreground ml-auto">{d.range} window</span>
        </div>

        {d.total === 0 ? (
          <Card class="px-5 py-16 text-center text-sm text-muted-foreground">
            no requests to this route in the {d.range} window
          </Card>
        ) : (
          <div class="space-y-6">
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card class="p-4">
                <div class="text-xs font-medium text-muted-foreground">Requests</div>
                <div class="mt-1.5 text-2xl font-bold text-foreground tabular font-mono">
                  {commas(d.total)}
                </div>
                <div class="text-[11px] text-muted-foreground mt-0.5">{d.rpm}/min</div>
              </Card>
              <Card class="p-4">
                <div class="text-xs font-medium text-muted-foreground">Error rate</div>
                <div
                  class={[
                    "mt-1.5 text-2xl font-bold tabular font-mono",
                    d.errorRate > 5
                      ? "text-destructive"
                      : d.errorRate > 0
                        ? "text-warning"
                        : "text-success",
                  ]}
                >
                  {d.errorRate}%
                </div>
                <div class="text-[11px] text-muted-foreground mt-0.5">
                  {d.errorCount} of {commas(d.total)} are 5xx
                </div>
              </Card>
              <Card class="p-4">
                <div class="text-xs font-medium text-muted-foreground">p95 latency</div>
                <div class={["mt-1.5 text-2xl font-bold tabular font-mono", pctTone(d.p95)]}>
                  {d.p95}ms
                </div>
                <div class="text-[11px] text-muted-foreground mt-0.5">
                  p50 {d.p50}ms · p99 {d.p99}ms
                </div>
              </Card>
              <Card class="p-4">
                <div class="text-xs font-medium text-muted-foreground">Avg response</div>
                <div class="mt-1.5 text-2xl font-bold text-foreground tabular font-mono">
                  {d.avgMs}ms
                </div>
                <div class="text-[11px] text-muted-foreground mt-0.5">max {d.maxMs}ms</div>
              </Card>
            </div>

            <div class="grid lg:grid-cols-2 gap-6">
              <Card class="p-5">
                <div class="text-sm font-semibold text-foreground mb-1">Throughput</div>
                <div class="text-[11px] text-muted-foreground mb-2">
                  requests over the {d.range} window
                </div>
                <Sparkline
                  series={d.throughput.some((v) => v > 0) ? d.throughput : [0, 0]}
                  class="w-full h-14 text-primary"
                />
              </Card>
              <Card class="p-5">
                <div class="text-sm font-semibold text-foreground mb-1">Avg latency</div>
                <div class="text-[11px] text-muted-foreground mb-2">
                  mean response time per bucket
                </div>
                <Sparkline
                  series={d.latency.some((v) => v > 0) ? d.latency : [0, 0]}
                  stroke="hsl(var(--chart-3))"
                  class="w-full h-14"
                />
              </Card>
            </div>

            <Card class="overflow-hidden">
              <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
                Response status
              </div>
              <div class="p-5 space-y-2.5">
                {d.statusDist.map((sc) => (
                  <div key={sc.label} class="flex items-center gap-3 text-sm">
                    <span class="font-mono text-xs text-muted-foreground w-8 shrink-0">
                      {sc.label}
                    </span>
                    <div class="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                      <div
                        class={["h-full rounded-full", this._statusClassTone(sc.label)]}
                        style={`width:${Math.round((sc.count / maxStatus) * 100)}%`}
                      />
                    </div>
                    <span class="tabular text-xs font-semibold text-muted-foreground w-12 text-right shrink-0">
                      {commas(sc.count)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <div class="grid lg:grid-cols-2 gap-6">
              <Card class="overflow-hidden">
                <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
                  Recent
                </div>
                <div class="divide-y divide-border">
                  {d.recent.map((r) => this._routeReqRow(r, `rec${r.id}`))}
                </div>
              </Card>
              <Card class="overflow-hidden">
                <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
                  Slowest
                </div>
                <div class="divide-y divide-border">
                  {d.slowest.map((r) => this._routeReqRow(r, `slow${r.id}`))}
                </div>
              </Card>
            </div>
          </div>
        )}
      </section>
    );
  }

  // ── Exceptions ──────────────────────────────────────────────────────────────

  private renderExceptions(): HtmlNode {
    return (
      <section class="space-y-3">
        {this.snap.exceptions.map((e) => {
          const open = this.openExc === e.type;
          return (
            <div key={e.type} class="rounded-xl bg-card border border-border shadow-sm p-4">
              <div
                class="flex items-start gap-3 cursor-pointer"
                onClick={() => this.toggleExc(e.type)}
              >
                <span class="mt-1 w-2 h-2 rounded-full bg-destructive shrink-0" />
                <div class="min-w-0 flex-1">
                  <div class="font-mono text-sm font-semibold text-foreground">{e.type}</div>
                  <div class="text-xs text-muted-foreground mt-0.5 truncate">{e.message}</div>
                  <div class="text-[11px] text-muted-foreground mt-1 font-mono truncate">
                    {e.location}
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <div class="text-lg font-bold text-destructive tabular">{e.count}</div>
                  <div class="text-[10px] text-muted-foreground">
                    <span class="tabular">{e.users}</span> users · last <span>{e.lastSeen}</span>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-4 mt-3">
                <div class="flex items-center gap-4 shrink-0">
                  {[
                    ["24h", e.d1],
                    ["7d", e.d7],
                    ["30d", e.d30],
                  ].map((b) => (
                    <div key={String(b[0])} class="text-center">
                      <div class="text-sm font-bold text-foreground tabular">{b[1]}</div>
                      <div class="text-[9px] uppercase tracking-wide text-muted-foreground">
                        {b[0]}
                      </div>
                    </div>
                  ))}
                </div>
                <svg class="flex-1 h-7" viewBox="0 0 400 28" preserveAspectRatio="none">
                  <polyline
                    points={sparkPoints(e.series, 400, 26)}
                    fill="none"
                    stroke="hsl(var(--destructive))"
                    stroke-width="1.5"
                    vector-effect="non-scaling-stroke"
                  />
                </svg>
                <span class="text-[11px] text-muted-foreground shrink-0">
                  {open ? "hide trace" : "show trace"}
                </span>
              </div>
              {open ? (
                <div class="mt-3 rounded-lg bg-foreground p-4 font-mono text-[11px] space-y-1 overflow-x-auto">
                  <div class="text-destructive/80">
                    {e.type}: {e.message}
                  </div>
                  {e.frames.map((f, fi) => (
                    <div key={fi} class="text-muted-foreground">
                      <span class="text-muted-foreground">at</span> <span>{f}</span>
                    </div>
                  ))}
                </div>
              ) : (
                ""
              )}
            </div>
          );
        })}
      </section>
    );
  }

  // ── Database ────────────────────────────────────────────────────────────────

  private renderDatabase(): HtmlNode {
    const s = this.snap;
    return (
      <section class="space-y-6">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {s.dbStats.map((m) => (
            <div key={m.label} class="rounded-xl bg-card border border-border p-4 shadow-sm">
              <div class="text-xs font-medium text-muted-foreground">{m.label}</div>
              <div class={["mt-1.5 text-2xl font-bold tabular font-mono", toneText(m.tone)]}>
                {m.value}
              </div>
              <div class="text-[11px] text-muted-foreground mt-0.5">{m.sub}</div>
            </div>
          ))}
        </div>
        <Card class="overflow-hidden">
          <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
            Slowest queries
          </div>
          <div class="divide-y divide-border">
            {s.slowQueries.map((q, i) => (
              <div key={i} class="px-5 py-3">
                <div class="flex items-center gap-3">
                  <span class="font-mono text-xs text-foreground truncate">{q.sql}</span>
                  <span
                    class={[
                      "ml-auto tabular font-semibold shrink-0",
                      q.ms > 400 ? "text-destructive" : "text-warning",
                    ]}
                  >
                    {q.ms}ms
                  </span>
                </div>
                <div class="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                  <span>{q.callers} callers</span>
                  <span>·</span>
                  <span class="font-mono truncate">{q.location}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div class="grid lg:grid-cols-2 gap-6">
          <Card class="overflow-hidden">
            <div class="px-5 py-3 border-b border-border flex items-center justify-between">
              <span class="font-semibold text-foreground text-sm">N+1 query offenders</span>
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-warning/10 text-warning">
                {s.nplusOnes.length}
              </span>
            </div>
            <div class="divide-y divide-border max-h-72 overflow-y-auto">
              {s.nplusOnes.length === 0 ? (
                <div class="px-5 py-8 text-center text-xs text-muted-foreground">
                  no N+1 detected 🎉
                </div>
              ) : (
                s.nplusOnes.map((n, i) => (
                  <div key={i} class="px-5 py-2.5">
                    <div class="flex items-center gap-3">
                      <span class="font-mono text-[11px] text-foreground truncate flex-1">
                        {n.fingerprint}
                      </span>
                      <span class="tabular text-xs font-semibold text-warning shrink-0">
                        ×{n.worstCount}
                      </span>
                    </div>
                    <div class="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                      {n.route ? <span class="font-mono truncate">{n.route}</span> : ""}
                      <span class="ml-auto shrink-0">
                        {n.occurrences} times · {n.lastSeen}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <div class="space-y-6">
            <Card class="p-5">
              <div class="text-sm font-semibold text-foreground mb-3">Transactions</div>
              <div class="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div class="text-2xl font-bold text-success tabular">
                    {commas(s.transactions.committed)}
                  </div>
                  <div class="text-[11px] text-muted-foreground">committed</div>
                </div>
                <div>
                  <div
                    class={[
                      "text-2xl font-bold tabular",
                      s.transactions.rolledBack > 0 ? "text-destructive" : "text-muted-foreground",
                    ]}
                  >
                    {commas(s.transactions.rolledBack)}
                  </div>
                  <div class="text-[11px] text-muted-foreground">rolled back</div>
                </div>
                <div>
                  <div class="text-2xl font-bold text-foreground tabular">
                    {s.transactions.avgMs}ms
                  </div>
                  <div class="text-[11px] text-muted-foreground">avg duration</div>
                </div>
              </div>
            </Card>
            <Card class="overflow-hidden">
              <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
                Recent migrations
              </div>
              <div class="divide-y divide-border max-h-44 overflow-y-auto">
                {s.migrations.length === 0 ? (
                  <div class="px-5 py-6 text-center text-xs text-muted-foreground">
                    none in range
                  </div>
                ) : (
                  s.migrations.map((m, i) => (
                    <div key={i} class="flex items-center gap-3 px-5 py-2 text-sm">
                      <span
                        class={[
                          "w-2 h-2 rounded-full shrink-0",
                          m.ok ? "bg-success" : "bg-destructive",
                        ]}
                      />
                      <span class="font-mono text-[11px] text-foreground truncate flex-1">
                        {m.name}
                      </span>
                      <span class="text-[10px] uppercase text-muted-foreground shrink-0">
                        {m.direction}
                      </span>
                      <span class="tabular text-[11px] text-muted-foreground shrink-0">
                        {m.ms}ms
                      </span>
                      <span class="text-[11px] text-muted-foreground shrink-0">{m.when}</span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>

        {this.renderModelsPanel()}
      </section>
    );
  }

  /** Per-model created/updated/deleted counts — Telescope's models watcher. */
  private renderModelsPanel(): HtmlNode {
    const models = this.snap.models;
    return (
      <Card class="overflow-hidden">
        <div class="px-5 py-3 border-b border-border flex items-center justify-between">
          <span class="font-semibold text-foreground text-sm">Model changes</span>
          <span class="text-xs text-muted-foreground">created · updated · deleted</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-[11px] uppercase tracking-wide text-muted-foreground bg-muted">
              <tr>
                <th class="px-5 py-2 font-medium">Model</th>
                <th class="px-3 py-2 font-medium">Table</th>
                <th class="px-3 py-2 font-medium text-right">Created</th>
                <th class="px-3 py-2 font-medium text-right">Updated</th>
                <th class="px-3 py-2 font-medium text-right">Deleted</th>
                <th class="px-3 py-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {models.length === 0 ? (
                <tr>
                  <td colspan="6" class="px-5 py-8 text-center text-xs text-muted-foreground">
                    no model changes in this range
                  </td>
                </tr>
              ) : (
                models.map((m) => (
                  <tr key={m.model} class="hover:bg-accent/60">
                    <td class="px-5 py-2.5 font-mono text-xs text-foreground">{m.model}</td>
                    <td class="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                      {m.table || "—"}
                    </td>
                    <td class="px-3 py-2.5 tabular text-right text-success font-semibold">
                      {commas(m.created)}
                    </td>
                    <td class="px-3 py-2.5 tabular text-right text-warning font-semibold">
                      {commas(m.updated)}
                    </td>
                    <td class="px-3 py-2.5 tabular text-right text-destructive font-semibold">
                      {commas(m.deleted)}
                    </td>
                    <td class="px-3 py-2.5 tabular text-right text-foreground font-semibold">
                      {commas(m.total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {this.snap.recentModels.length > 0 ? (
          <div class="border-t border-border">
            <div class="px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Recent changes
            </div>
            <div class="divide-y divide-border max-h-56 overflow-y-auto">
              {this.snap.recentModels.map((m, i) => (
                <div key={i} class="flex items-center gap-3 px-5 py-1.5 text-sm">
                  <span
                    class={[
                      "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 w-16 text-center",
                      m.operation === "created"
                        ? "bg-success/10 text-success"
                        : m.operation === "updated"
                          ? "bg-warning/10 text-warning"
                          : "bg-destructive/10 text-destructive",
                    ]}
                  >
                    {m.operation}
                  </span>
                  <span class="font-mono text-xs text-foreground truncate flex-1">{m.model}</span>
                  <span class="font-mono text-[11px] text-muted-foreground shrink-0">
                    {m.table || "—"}
                  </span>
                  <span class="text-[11px] text-muted-foreground tabular shrink-0 w-16 text-right">
                    {m.when}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          ""
        )}
      </Card>
    );
  }

  // ── Cache ─────────────────────────────────────────────────────────────────

  private renderCache(): HtmlNode {
    const c = this.snap.cache;
    return (
      <section class="space-y-6">
        <div class="grid sm:grid-cols-3 gap-4">
          <Card class="p-5 sm:col-span-1">
            <div class="text-xs font-medium text-muted-foreground">Hit rate</div>
            <div class="mt-2 flex items-end gap-2">
              <div class="text-4xl font-bold text-success tabular">{c.hitRate}%</div>
            </div>
            <div class="mt-3 h-2 rounded-full bg-muted overflow-hidden">
              <div class="h-full bg-success transition-all" style={`width:${c.hitRate}%`} />
            </div>
            <div class="mt-2 flex justify-between text-[11px] text-muted-foreground tabular">
              <span>{c.hits.toLocaleString()} hits</span>
              <span>{c.misses.toLocaleString()} misses</span>
            </div>
            <div class="mt-1 text-[11px] text-muted-foreground tabular border-t border-border pt-1.5">
              {c.evictions.toLocaleString()} evictions
            </div>
          </Card>
          <Card class="sm:col-span-2 overflow-hidden">
            <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
              Hottest keys
            </div>
            <div class="divide-y divide-border">
              {c.keys.map((k) => (
                <div key={k.key} class="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span class="font-mono text-xs text-foreground truncate">{k.key}</span>
                  <span class="ml-auto tabular text-xs text-muted-foreground">
                    {k.hits.toLocaleString()} hits
                  </span>
                  <span
                    class={[
                      "tabular text-[11px] w-12 text-right",
                      k.rate > 90 ? "text-success" : "text-warning",
                    ]}
                  >
                    {k.rate}%
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>
    );
  }

  // ── Mail ────────────────────────────────────────────────────────────────────

  private renderMail(): HtmlNode {
    return (
      <section class="space-y-3">
        {this.snap.mail.map((m) => {
          const open = this.openMailId === m.id;
          return (
            <div
              key={m.id}
              class="rounded-xl bg-card border border-border shadow-sm overflow-hidden"
            >
              <div
                class="flex items-center gap-3 px-5 py-3 text-sm cursor-pointer hover:bg-accent/60"
                onClick={() => this.toggleMail(m.id)}
              >
                <span class="grid place-items-center w-8 h-8 rounded-lg bg-primary/10 text-primary shrink-0">
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    class="w-4 h-4"
                  >
                    <rect x="2.5" y="4" width="15" height="12" rx="1.5" />
                    <path d="M3 5l7 5.5L17 5" />
                  </svg>
                </span>
                <div class="min-w-0">
                  <div class="font-semibold text-foreground truncate">{m.subject}</div>
                  <div class="text-[11px] text-muted-foreground">
                    to <span>{m.to}</span> · <span class="font-mono">{m.mailer}</span>
                  </div>
                </div>
                <span
                  class={[
                    "ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase shrink-0",
                    m.status === "sent"
                      ? "bg-success/10 text-success"
                      : m.status === "queued"
                        ? "bg-warning/10 text-warning"
                        : "bg-destructive/10 text-destructive",
                  ]}
                >
                  {m.status}
                </span>
                <span class="text-[11px] text-muted-foreground whitespace-nowrap">{m.when}</span>
              </div>
              {open ? (
                <div class="border-t border-border bg-muted/50 p-5">
                  {m.status === "sent" && /<\w+[\s/>]/.test(m.body) ? (
                    // Render the email HTML in a sandboxed iframe (no scripts) — a real preview.
                    <iframe
                      srcdoc={m.body}
                      sandbox=""
                      title="Email preview"
                      class="w-full h-96 rounded-lg bg-card border border-border"
                    />
                  ) : (
                    <div class="rounded-lg bg-card border border-border p-4 text-sm text-muted-foreground whitespace-pre-line">
                      {m.body}
                    </div>
                  )}
                  {m.ms ? (
                    <div class="text-[11px] text-muted-foreground mt-2">rendered in {m.ms}ms</div>
                  ) : (
                    ""
                  )}
                </div>
              ) : (
                ""
              )}
            </div>
          );
        })}
      </section>
    );
  }

  // ── Shared feed controls (search + status filter + pagination) ───────────────

  /** A search box, with an optional OK/Failed status filter, for a secondary feed. */
  private _feedControls(placeholder: string, showStatus: boolean): HtmlNode {
    return (
      <div class="flex flex-wrap items-center gap-3">
        <div class="relative flex-1 min-w-[200px]">
          <svg
            class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
          >
            <circle cx="9" cy="9" r="6" />
            <path d="M14 14l3 3" stroke-linecap="round" />
          </svg>
          <input
            value={this.feedQ}
            live
            type="text"
            placeholder={placeholder}
            class="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
          />
        </div>
        {showStatus ? (
          <div class="flex items-center p-0.5 rounded-lg bg-muted border border-border">
            {[
              ["all", "All"],
              ["ok", "OK"],
              ["failed", "Failed"],
            ].map((f) => (
              <button
                key={f[0]}
                onClick={() => this.setFeedStatus(f[0]!)}
                class={[
                  "px-2.5 py-1 rounded-md text-xs font-semibold transition-colors",
                  this.feedStatus === f[0]
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                ]}
              >
                {f[1]}
              </button>
            ))}
          </div>
        ) : (
          ""
        )}
      </div>
    );
  }

  /** The pagination footer for a secondary feed; renders nothing when it fits one page. */
  private _feedFooter(total: number): HtmlNode {
    if (total <= FEED_PER_PAGE) return <span />;
    const { page, totalPages, start } = this._feedSlice(total);
    return (
      <div class="px-5 py-2.5 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
        <span class="tabular">
          {start + 1}–{Math.min(start + FEED_PER_PAGE, total)} of {total}
        </span>
        <div class="flex items-center gap-1">
          <button
            onClick={this.prevFeedPage}
            class={[
              "px-2.5 py-1 rounded-md border text-xs font-semibold transition-colors",
              page === 0
                ? "border-border text-muted-foreground cursor-not-allowed"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary",
            ]}
          >
            Prev
          </button>
          <span class="px-2 tabular text-muted-foreground">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={this.nextFeedPage}
            class={[
              "px-2.5 py-1 rounded-md border text-xs font-semibold transition-colors",
              page >= totalPages - 1
                ? "border-border text-muted-foreground cursor-not-allowed"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary",
            ]}
          >
            Next
          </button>
        </div>
      </div>
    );
  }

  // ── Notifications (distinct from Mail — one row per channel delivery) ────────

  /** Tailwind classes tinting a notification-channel chip. */
  private _channelTone(channel: string): string {
    return channel === "mail"
      ? "bg-primary/10 text-primary"
      : channel === "database"
        ? "bg-primary/10 text-primary"
        : channel === "slack"
          ? "bg-success/10 text-success"
          : channel === "sms"
            ? "bg-warning/10 text-warning"
            : "bg-muted text-muted-foreground";
  }

  private renderNotifications(): HtmlNode {
    const all = this._filteredNotifications();
    const { start, end } = this._feedSlice(all.length);
    const rows = all.slice(start, end);
    return (
      <section class="space-y-4">
        {this._feedControls("Filter by notification, recipient, or channel…", true)}
        <Card class="overflow-hidden">
          <div class="px-5 py-3 border-b border-border flex items-center justify-between">
            <span class="font-semibold text-foreground text-sm">
              Notifications ·{" "}
              <span class="text-muted-foreground font-normal">{all.length} shown</span>
            </span>
            <span class="text-xs text-muted-foreground">one row per channel delivery</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-[11px] uppercase tracking-wide text-muted-foreground bg-muted">
                <tr>
                  <th class="px-5 py-2 font-medium">Notification</th>
                  <th class="px-3 py-2 font-medium">Channel</th>
                  <th class="px-3 py-2 font-medium">Recipient</th>
                  <th class="px-3 py-2 font-medium">Status</th>
                  <th class="px-3 py-2 font-medium">Time</th>
                  <th class="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colspan="6" class="px-5 py-10 text-center text-sm text-muted-foreground">
                      {this.snap.notifications.length === 0
                        ? "no notifications sent in this range"
                        : "no notifications match the filter"}
                    </td>
                  </tr>
                ) : (
                  rows.map((n, i) => (
                    <tr key={i} class="hover:bg-accent/60">
                      <td class="px-5 py-2.5 font-mono text-xs text-foreground truncate max-w-[220px]">
                        {n.notification}
                      </td>
                      <td class="px-3 py-2.5">
                        <span
                          class={[
                            "text-[10px] font-bold px-1.5 py-0.5 rounded capitalize",
                            this._channelTone(n.channel),
                          ]}
                        >
                          {n.channel}
                        </span>
                      </td>
                      <td class="px-3 py-2.5 text-xs text-muted-foreground truncate max-w-[180px]">
                        {n.recipient}
                      </td>
                      <td class="px-3 py-2.5">
                        <span
                          class={[
                            "text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase",
                            n.status === "ok"
                              ? "bg-success/10 text-success"
                              : "bg-destructive/10 text-destructive",
                          ]}
                        >
                          {n.status === "ok" ? "sent" : "failed"}
                        </span>
                      </td>
                      <td class="px-3 py-2.5 tabular text-xs text-muted-foreground">{n.ms}ms</td>
                      <td class="px-3 py-2.5 text-[11px] text-muted-foreground tabular whitespace-nowrap">
                        {n.when}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {this._feedFooter(all.length)}
        </Card>
      </section>
    );
  }

  // ── Commands (console / Artisan runs) ────────────────────────────────────────

  private renderCommands(): HtmlNode {
    const all = this._filteredCommands();
    const { start, end } = this._feedSlice(all.length);
    const rows = all.slice(start, end);
    return (
      <section class="space-y-4">
        {this._feedControls("Filter by command name…", true)}
        <Card class="overflow-hidden">
          <div class="px-5 py-3 border-b border-border flex items-center justify-between">
            <span class="font-semibold text-foreground text-sm">
              Command runs · <span class="text-muted-foreground font-normal">{all.length}</span>
            </span>
            <span class="text-xs text-muted-foreground">CLI + in-process Artisan calls</span>
          </div>
          <div class="divide-y divide-border">
            {rows.length === 0 ? (
              <div class="px-5 py-10 text-center text-sm text-muted-foreground">
                {this.snap.commands.length === 0
                  ? "no commands run in this range"
                  : "no commands match the filter"}
              </div>
            ) : (
              rows.map((c, i) => (
                <div key={i} class="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span
                    class={[
                      "w-2 h-2 rounded-full shrink-0",
                      c.status === "ok" ? "bg-success" : "bg-destructive",
                    ]}
                  />
                  <span class="font-mono text-xs text-foreground truncate flex-1">{c.name}</span>
                  <span
                    class={[
                      "text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase shrink-0",
                      c.status === "ok"
                        ? "bg-success/10 text-success"
                        : "bg-destructive/10 text-destructive",
                    ]}
                  >
                    exit {c.code}
                  </span>
                  <span class="tabular text-xs font-semibold text-muted-foreground shrink-0 w-16 text-right">
                    {c.ms}ms
                  </span>
                  <span class="text-[11px] text-muted-foreground tabular shrink-0 w-16 text-right whitespace-nowrap">
                    {c.when}
                  </span>
                </div>
              ))
            )}
          </div>
          {this._feedFooter(all.length)}
        </Card>
      </section>
    );
  }

  // ── System / health ─────────────────────────────────────────────────────────

  private renderSystem(): HtmlNode {
    const s = this.snap;
    return (
      <section class="space-y-6">
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {s.health.map((h) => (
            <div
              key={h.name}
              class="rounded-xl bg-card border border-border p-4 shadow-sm flex items-center gap-3"
            >
              <span
                class={[
                  "grid place-items-center w-9 h-9 rounded-lg shrink-0",
                  h.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                ]}
              >
                {h.ok ? (
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    class="w-4 h-4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M4 10.5l4 4 8-9" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    class="w-4 h-4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M5 5l10 10M15 5L5 15" />
                  </svg>
                )}
              </span>
              <div class="min-w-0">
                <div class="text-sm font-semibold text-foreground">{h.name}</div>
                <div class="text-[11px] text-muted-foreground tabular">{h.detail}</div>
              </div>
            </div>
          ))}
        </div>

        <div class="grid lg:grid-cols-3 gap-4">
          {s.gauges.map((g) => (
            <div key={g.label} class="rounded-xl bg-card border border-border p-5 shadow-sm">
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-medium text-muted-foreground">{g.label}</span>
                <span class={["tabular font-bold", gaugeText(g.value)]}>{g.value}%</span>
              </div>
              <div class="h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  class={["h-full transition-all", gaugeBar(g.value)]}
                  style={`width:${g.value}%`}
                />
              </div>
              <div class="mt-1.5 text-[11px] text-muted-foreground">{g.sub}</div>
            </div>
          ))}
        </div>

        <div class="grid lg:grid-cols-2 gap-6">
          <Card class="overflow-hidden">
            <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
              Uptime checks
            </div>
            <div class="divide-y divide-border">
              {s.uptimeChecks.map((u) => (
                <div key={u.name} class="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span
                    class={[
                      "w-2 h-2 rounded-full shrink-0",
                      u.ok ? "bg-success" : "bg-destructive",
                    ]}
                  />
                  <span class="font-mono text-xs text-foreground truncate">{u.name}</span>
                  <span
                    class={[
                      "ml-auto tabular text-xs",
                      u.ok ? "text-muted-foreground" : "text-destructive font-semibold",
                    ]}
                  >
                    {u.ok ? `${u.ms}ms` : "down"}
                  </span>
                  <span class="tabular text-[11px] text-muted-foreground w-14 text-right">
                    {u.uptime}
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <Card class="overflow-hidden">
            <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
              Scheduled task check-ins
            </div>
            <div class="divide-y divide-border">
              {s.checkins.map((c) => (
                <div key={c.name} class="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span
                    class={[
                      "text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase shrink-0",
                      c.status === "ok"
                        ? "bg-success/10 text-success"
                        : c.status === "late"
                          ? "bg-warning/10 text-warning"
                          : "bg-destructive/10 text-destructive",
                    ]}
                  >
                    {c.status}
                  </span>
                  <span class="font-mono text-xs text-foreground truncate">{c.name}</span>
                  <span class="font-mono text-[11px] text-muted-foreground hidden sm:inline">
                    {c.cron}
                  </span>
                  <span class="ml-auto text-[11px] text-muted-foreground whitespace-nowrap">
                    ran {c.last}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card class="overflow-hidden">
          <div class="px-5 py-3 border-b border-border flex items-center justify-between">
            <span class="font-semibold text-foreground text-sm">Scheduled task runs</span>
            <span class="text-xs text-muted-foreground">history · ok / failed / skipped</span>
          </div>
          <div class="divide-y divide-border max-h-72 overflow-y-auto">
            {s.scheduledRuns.length === 0 ? (
              <div class="px-5 py-8 text-center text-xs text-muted-foreground">
                no task runs in this range
              </div>
            ) : (
              s.scheduledRuns.map((e, i) => this._feedRow(e, i))
            )}
          </div>
        </Card>

        {this.renderStoragePanel()}

        <Card class="p-5 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
          <div>
            <span class="text-muted-foreground text-xs">Uptime</span>
            <div class="font-semibold text-foreground tabular">{s.meta.uptime}</div>
          </div>
          <div>
            <span class="text-muted-foreground text-xs">Bun</span>
            <div class="font-semibold text-foreground font-mono">{s.meta.bun}</div>
          </div>
          <div>
            <span class="text-muted-foreground text-xs">Zerotal</span>
            <div class="font-semibold text-foreground font-mono">{s.meta.zerotal}</div>
          </div>
          <div>
            <span class="text-muted-foreground text-xs">Region</span>
            <div class="font-semibold text-foreground">{s.meta.region}</div>
          </div>
          <div>
            <span class="text-muted-foreground text-xs">Deploy</span>
            <div class="font-semibold text-foreground font-mono">{s.meta.deploy}</div>
          </div>
        </Card>
      </section>
    );
  }

  /** Storage & retention panel: persisted-row counts plus cleanup controls. */
  private renderStoragePanel(): HtmlNode {
    const st = this.snap.storage;
    const cfg = this._config();
    const days = cfg?.retentionDays ?? 7;
    const mode = cfg?.retentionMode ?? "delete";
    const cards: Array<[string, number]> = [
      ["Requests", st.requests],
      ["Queries", st.queries],
      ["Exceptions", st.exceptions],
      ["HTTP calls", st.httpCalls],
      ["Cache ops", st.cacheEvents],
      ["Mail", st.mail],
      ["Jobs", st.jobs],
      ["Archived", st.archived],
    ];
    return (
      <Card class="overflow-hidden">
        <div class="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
          <div class="font-semibold text-foreground text-sm">Storage &amp; retention</div>
          <div class="text-[11px] text-muted-foreground">
            keeping <span class="font-semibold text-muted-foreground">{days}d</span> · then {mode}
          </div>
        </div>
        <div class="p-5 space-y-4">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {cards.map(([label, value]) => (
              <div key={label} class="rounded-lg bg-muted border border-border px-3 py-2">
                <div class="text-[11px] text-muted-foreground">{label}</div>
                <div class="tabular font-semibold text-foreground">{commas(value)}</div>
              </div>
            ))}
          </div>
          <div class="flex items-center justify-between flex-wrap gap-3">
            <div class="text-[11px] text-muted-foreground">
              {st.oldestMs ? `oldest record ${ago(st.oldestMs)}` : "no data recorded yet"}
            </div>
            <div class="flex items-center gap-2">
              <a
                href={`${this.basePath.replace(/\/$/, "")}/export.json?range=${this.range}`}
                download
                class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
              >
                Export JSON
              </a>
              <button
                onClick={this.cleanupData}
                loadingAttr="disabled"
                class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
              >
                Clean up now
              </button>
              <button
                onClick={this.clearData}
                confirm="Permanently delete ALL recorded monitor data? This cannot be undone."
                loadingAttr="disabled"
                class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
              >
                Clear all
              </button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // ── Security / audit ─────────────────────────────────────────────────────────

  private _statusDot(status: FeedEvent["status"]): string {
    return status === "bad"
      ? "bg-destructive"
      : status === "warn"
        ? "bg-warning"
        : status === "ok"
          ? "bg-success"
          : "bg-muted-foreground/40";
  }

  private _feedRow(e: FeedEvent, i: number): HtmlNode {
    return (
      <div key={i} class="flex items-center gap-3 px-5 py-2.5 text-sm">
        <span class={["w-2 h-2 rounded-full shrink-0", this._statusDot(e.status)]} />
        <span class="font-mono text-xs text-foreground whitespace-nowrap">{e.label}</span>
        {e.route ? (
          <span class="text-[11px] text-muted-foreground font-mono truncate">{e.route}</span>
        ) : (
          ""
        )}
        {e.detail ? (
          <span class="text-[11px] text-muted-foreground truncate flex-1">{e.detail}</span>
        ) : (
          <span class="flex-1" />
        )}
        <span class="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">{e.when}</span>
      </div>
    );
  }

  private renderSecurity(): HtmlNode {
    const all = this._filteredSecurity();
    const { start, end } = this._feedSlice(all.length);
    const rows = all.slice(start, end);
    return (
      <section class="space-y-4">
        {this._feedControls("Filter by event, user, or guard…", false)}
        <Card class="overflow-hidden">
          <div class="px-5 py-3 border-b border-border flex items-center justify-between">
            <span class="font-semibold text-foreground text-sm">
              Security &amp; audit ·{" "}
              <span class="text-muted-foreground font-normal">{all.length} shown</span>
            </span>
            <span class="text-xs text-muted-foreground">logins · logouts · denials · tokens</span>
          </div>
          <div class="divide-y divide-border">
            {rows.length === 0 ? (
              <div class="px-5 py-12 text-center text-sm text-muted-foreground">
                {this.snap.security.length === 0
                  ? "no security events in this range"
                  : "no events match the filter"}
              </div>
            ) : (
              rows.map((e, i) => this._feedRow(e, i))
            )}
          </div>
          {this._feedFooter(all.length)}
        </Card>
      </section>
    );
  }

  // ── Alerts (threshold-alert history) ─────────────────────────────────────────

  private renderAlertsTab(): HtmlNode {
    const alerts = this.snap.alertHistory;
    return (
      <section class="space-y-3">
        <div class="flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span>
            {alerts.length} alert {alerts.length === 1 ? "kind" : "kinds"} · grouped · click to
            expand
          </span>
          <span class="hidden sm:inline">error rate · p95 · queue backlog · rollbacks</span>
        </div>
        {alerts.length === 0 ? (
          <Card class="px-5 py-16 text-center text-sm text-muted-foreground">
            no alerts fired in this range — all thresholds nominal 🎉
          </Card>
        ) : (
          alerts.map((a) => {
            const open = this.openAlert === a.id;
            const critical = a.level === "critical";
            return (
              <div
                key={a.id}
                class="rounded-xl bg-card border border-border shadow-sm overflow-hidden"
              >
                <div
                  class="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-accent/60"
                  onClick={() => this.toggleAlert(a.id)}
                >
                  <span
                    class={[
                      "w-2 h-2 rounded-full shrink-0",
                      critical ? "bg-destructive" : "bg-warning",
                    ]}
                  />
                  <span class="font-semibold text-foreground text-sm shrink-0">{a.title}</span>
                  <span
                    class={[
                      "text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase shrink-0",
                      critical
                        ? "bg-destructive/10 text-destructive"
                        : "bg-warning/10 text-warning",
                    ]}
                  >
                    {a.level}
                  </span>
                  {a.count > 1 ? (
                    <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                      ×{a.count}
                    </span>
                  ) : (
                    ""
                  )}
                  <span class="text-xs text-muted-foreground truncate hidden md:inline">
                    {a.detail}
                  </span>
                  <span class="ml-auto text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                    last {a.lastSeen}
                  </span>
                  <span class="text-muted-foreground shrink-0 text-[10px]">{open ? "▲" : "▼"}</span>
                </div>
                {open ? this._renderAlertDetail(a) : ""}
              </div>
            );
          })
        )}
      </section>
    );
  }

  /** Expanded alert: the breach headline, the captured state, and the firing timeline. */
  private _renderAlertDetail(a: AlertEntry): HtmlNode {
    const c = a.context;
    const fmt = (v: number, unit: string): string =>
      unit === "ms" ? `${v}ms` : unit === "%" ? `${v}%` : commas(v);
    const stats: Array<[string, string]> = [
      ["Error rate", `${c.errorRate}%`],
      ["p50 / p95 / p99", `${c.p50} / ${c.p95} / ${c.p99}ms`],
      ["Requests / min", commas(c.rpm)],
      ["Apdex", c.apdex.toFixed(2)],
      ["Pending jobs", commas(c.pending)],
      ["Rollbacks", commas(c.rolledBack)],
    ];
    return (
      <div class="border-t border-border bg-muted/50 px-5 py-4 space-y-4">
        <div class="flex items-baseline gap-2 flex-wrap">
          <span class="text-xs text-muted-foreground">{a.metric}</span>
          <span
            class={[
              "text-2xl font-bold tabular font-mono",
              a.level === "critical" ? "text-destructive" : "text-warning",
            ]}
          >
            {fmt(a.value, a.unit)}
          </span>
          <span class="text-[11px] text-muted-foreground">
            vs threshold {fmt(a.threshold, a.unit)}
          </span>
          <span class="text-[11px] text-muted-foreground ml-auto">
            first {a.firstSeen} · last {a.lastSeen}
          </span>
        </div>

        <div>
          <div class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            State when it fired
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {stats.map(([label, value]) => (
              <div key={label} class="rounded-lg bg-card border border-border px-3 py-2">
                <div class="text-[11px] text-muted-foreground">{label}</div>
                <div class="tabular font-semibold text-foreground text-sm">{value}</div>
              </div>
            ))}
          </div>
        </div>

        {c.slowRoutes.length > 0 || c.topException ? (
          <div class="grid sm:grid-cols-2 gap-3">
            {c.slowRoutes.length > 0 ? (
              <div class="rounded-lg bg-card border border-border overflow-hidden">
                <div class="px-3 py-2 text-[11px] font-semibold text-muted-foreground border-b border-border">
                  Slowest routes then
                </div>
                <div class="divide-y divide-border">
                  {c.slowRoutes.map((r) => (
                    <div
                      key={r.path + r.method}
                      class="flex items-center gap-2 px-3 py-1.5 text-xs"
                    >
                      <span
                        class={[
                          "text-[9px] font-bold px-1 py-0.5 rounded shrink-0",
                          methodTone(r.method),
                        ]}
                      >
                        {r.method}
                      </span>
                      <span class="font-mono text-muted-foreground truncate flex-1">{r.path}</span>
                      <span class="tabular font-semibold text-muted-foreground shrink-0">
                        {r.ms}ms
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              ""
            )}
            {c.topException ? (
              <div class="rounded-lg bg-card border border-border px-3 py-2.5 flex items-center gap-2">
                <span class="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                <span class="text-[11px] text-muted-foreground">top exception</span>
                <span class="font-mono text-xs text-foreground truncate">{c.topException}</span>
              </div>
            ) : (
              ""
            )}
          </div>
        ) : (
          ""
        )}

        {a.count > 1 ? (
          <div>
            <div class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Recent firings ({a.count})
            </div>
            <div class="rounded-lg bg-card border border-border divide-y divide-border max-h-44 overflow-y-auto">
              {a.occurrences.map((o, i) => (
                <div key={i} class="flex items-center gap-3 px-3 py-1.5 text-xs">
                  <span class="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                  <span class="text-muted-foreground truncate flex-1">{o.detail}</span>
                  <span class="text-[11px] text-muted-foreground tabular shrink-0">{o.when}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          ""
        )}
      </div>
    );
  }

  // ── Logs ─────────────────────────────────────────────────────────────────────

  private _logTone(level: string): string {
    return level === "error" || level === "fatal"
      ? "text-destructive"
      : level === "warn"
        ? "text-warning"
        : level === "debug"
          ? "text-muted-foreground"
          : "text-success";
  }

  private renderLogs(): HtmlNode {
    const all = this.snap.logs;
    const lines = this.logLevel === "all" ? all : all.filter((l) => l.label === this.logLevel);
    return (
      <section class="space-y-4">
        <div class="flex items-center p-0.5 rounded-lg bg-muted border border-border w-fit">
          {["all", "debug", "info", "warn", "error"].map((lv) => (
            <button
              key={lv}
              onClick={() => this.setLogLevel(lv)}
              class={[
                "px-2.5 py-1 rounded-md text-xs font-semibold capitalize transition-colors",
                this.logLevel === lv
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              ]}
            >
              {lv}
            </button>
          ))}
        </div>
        <div class="rounded-xl bg-foreground shadow-sm overflow-hidden">
          <div class="px-5 py-2.5 border-b border-border flex items-center justify-between">
            <span class="font-semibold text-muted-foreground text-sm">Application logs</span>
            <span class="text-[11px] text-muted-foreground">{lines.length} lines</span>
          </div>
          <div class="divide-y divide-border max-h-[72vh] overflow-y-auto font-mono text-[11px]">
            {lines.length === 0 ? (
              <div class="px-5 py-12 text-center text-muted-foreground">no logs in this range</div>
            ) : (
              lines.map((l, i) => (
                <div key={i} class="flex items-start gap-3 px-5 py-1.5 hover:bg-accent">
                  <span class={["uppercase font-bold shrink-0 w-12", this._logTone(l.label)]}>
                    {l.label}
                  </span>
                  <span class="text-muted-foreground flex-1 break-all">{l.detail}</span>
                  {l.route ? (
                    <span class="text-muted-foreground shrink-0" title="request id">
                      {l.route.slice(0, 8)}
                    </span>
                  ) : (
                    ""
                  )}
                  <span class="text-muted-foreground shrink-0 whitespace-nowrap">{l.when}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    );
  }

  // ── Realtime / WebSocket ─────────────────────────────────────────────────────

  private renderRealtime(): HtmlNode {
    const r = this.snap.realtime;
    const actions = this._filteredWsActions();
    const { start, end } = this._feedSlice(actions.length);
    const actionRows = actions.slice(start, end);
    const cards: Array<[string, string, string]> = [
      ["Active connections", commas(r.activeConnections), "live WebSocket"],
      ["Actions / min", String(r.actionsPerMin), "round-trips"],
      ["Avg action", `${r.avgActionMs}ms`, `${this._fmtMem(r.avgMemKb)} heap`],
      ["Opened / closed", `${commas(r.opened)} / ${commas(r.closed)}`, "in range"],
    ];
    return (
      <section class="space-y-6">
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map(([label, value, sub]) => (
            <div key={label} class="rounded-xl bg-card border border-border p-5 shadow-sm">
              <div class="text-sm text-muted-foreground">{label}</div>
              <div class="text-2xl font-bold text-foreground tabular mt-1">{value}</div>
              <div class="text-[11px] text-muted-foreground mt-1">{sub}</div>
            </div>
          ))}
        </div>

        {this._feedControls("Filter by component, action, user, or IP…", true)}

        <div class="grid lg:grid-cols-3 gap-6">
          {this.renderConnectedClients()}

          <Card class="overflow-hidden">
            <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
              Busiest components
            </div>
            <div class="divide-y divide-border">
              {r.components.length === 0 ? (
                <div class="px-5 py-8 text-center text-xs text-muted-foreground">
                  no actions yet
                </div>
              ) : (
                r.components.map((c) => (
                  <div key={c.name} class="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span class="font-mono text-xs text-foreground truncate flex-1">{c.name}</span>
                    <span class="tabular text-[11px] text-muted-foreground shrink-0">
                      {c.avgMs}ms avg
                    </span>
                    <span class="tabular text-xs font-semibold text-foreground w-12 text-right shrink-0">
                      {commas(c.actions)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card class="overflow-hidden">
            <div class="px-5 py-3 border-b border-border font-semibold text-foreground text-sm">
              Slowest actions
            </div>
            <div class="divide-y divide-border">
              {r.slowActions.length === 0 ? (
                <div class="px-5 py-8 text-center text-xs text-muted-foreground">
                  no actions yet
                </div>
              ) : (
                r.slowActions.map((a, i) => (
                  <div key={i} class="flex items-center gap-2 px-5 py-2.5 text-sm">
                    <span class="font-mono text-xs text-muted-foreground truncate">
                      {a.component}
                    </span>
                    <span class="font-mono text-[11px] text-primary shrink-0">{a.action}()</span>
                    <span
                      class={[
                        "ml-auto tabular text-xs font-semibold shrink-0",
                        a.ms > 500
                          ? "text-destructive"
                          : a.ms > 200
                            ? "text-warning"
                            : "text-muted-foreground",
                      ]}
                    >
                      {a.ms}ms
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <Card class="overflow-hidden">
          <div class="px-5 py-3 border-b border-border flex items-center justify-between">
            <span class="font-semibold text-foreground text-sm">
              Recent actions ·{" "}
              <span class="text-muted-foreground font-normal">{actions.length} shown</span>
            </span>
            <span class="text-xs text-muted-foreground">
              user · ip · queries — click for the trace
            </span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-[11px] uppercase tracking-wide text-muted-foreground bg-muted">
                <tr>
                  <th class="px-5 py-2 font-medium">Component</th>
                  <th class="px-3 py-2 font-medium">Action</th>
                  <th class="px-3 py-2 font-medium">User</th>
                  <th class="px-3 py-2 font-medium">IP</th>
                  <th class="px-3 py-2 font-medium">Queries</th>
                  <th class="px-3 py-2 font-medium">Memory</th>
                  <th class="px-3 py-2 font-medium">Time</th>
                  <th class="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {actionRows.length === 0 ? (
                  <tr>
                    <td colspan="8" class="px-5 py-10 text-center text-sm text-muted-foreground">
                      {r.recentActions.length === 0
                        ? "no WebSocket actions in this range"
                        : "no actions match the filter"}
                    </td>
                  </tr>
                ) : (
                  actionRows.map((a) => this.renderWsActionRows(a))
                )}
              </tbody>
            </table>
          </div>
          {this._feedFooter(actions.length)}
        </Card>
      </section>
    );
  }

  /** Who is connected right now over the Flow WebSocket (live, not windowed). */
  private renderConnectedClients(): HtmlNode {
    const clients = this.snap.realtime.clients;
    return (
      <Card class="overflow-hidden">
        <div class="px-5 py-3 border-b border-border flex items-center justify-between">
          <span class="font-semibold text-foreground text-sm">Connected clients</span>
          <span class="text-[11px] text-muted-foreground">{clients.length} online</span>
        </div>
        <div class="divide-y divide-border max-h-72 overflow-y-auto">
          {clients.length === 0 ? (
            <div class="px-5 py-8 text-center text-xs text-muted-foreground">
              no clients connected
            </div>
          ) : (
            clients.map((c) => (
              <div key={c.id} class="px-5 py-2.5">
                <div class="flex items-center gap-2">
                  <span
                    class={[
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      c.user ? "bg-success" : "bg-muted-foreground/40",
                    ]}
                  />
                  <span class="text-xs text-foreground truncate flex-1">{c.user ?? "guest"}</span>
                  <span class="tabular text-xs font-semibold text-foreground shrink-0">
                    {commas(c.actions)}
                  </span>
                </div>
                <div class="flex items-center gap-2 mt-0.5 pl-3.5 text-[11px] text-muted-foreground">
                  <span class="font-mono truncate">{c.ip}</span>
                  <span class="ml-auto shrink-0 whitespace-nowrap">{c.lastActivity}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    );
  }

  private renderWsActionRows(a: WsAction): HtmlNode[] {
    const open = this.openWsAction === a.id;
    const rows: HtmlNode[] = [
      <tr
        key={`wa${a.id}`}
        class="hover:bg-accent/60 cursor-pointer"
        onClick={() => this.toggleWsAction(a.id)}
      >
        <td class="px-5 py-2.5">
          <span
            class={[
              "w-2 h-2 rounded-full inline-block mr-2",
              a.ok ? "bg-success" : "bg-destructive",
            ]}
          />
          <span class="font-mono text-xs text-foreground">{a.component}</span>
        </td>
        <td class="px-3 py-2.5 font-mono text-[11px] text-primary">{a.action}()</td>
        <td class="px-3 py-2.5 text-xs text-muted-foreground truncate max-w-[140px]">
          {a.user ?? "guest"}
        </td>
        <td class="px-3 py-2.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
          {a.ip ?? "—"}
        </td>
        <td class="px-3 py-2.5 tabular text-muted-foreground">
          {a.queries.length}
          {a.nplus ? <span class="ml-1 text-[10px] font-bold text-destructive">N+1</span> : ""}
        </td>
        <td class="px-3 py-2.5 tabular text-xs text-muted-foreground whitespace-nowrap">
          {this._fmtMem(a.memKb)}
        </td>
        <td
          class={[
            "px-3 py-2.5 tabular",
            a.ms > 500 ? "text-destructive" : a.ms > 200 ? "text-warning" : "text-muted-foreground",
          ]}
        >
          {a.ms}ms
        </td>
        <td class="px-3 py-2.5 text-[11px] text-muted-foreground tabular whitespace-nowrap">
          {a.when}
        </td>
      </tr>,
    ];
    if (open) {
      rows.push(
        <tr key={`wd${a.id}`}>
          <td colspan="8" class="px-5 pb-4 pt-1 bg-muted/50">
            {Object.keys(a.context).length > 0 ? (
              <div class="flex flex-wrap items-center gap-1.5 px-1 py-2">
                {this._contextChips(a.context)}
              </div>
            ) : (
              ""
            )}
            <div class="rounded-lg bg-foreground p-4 font-mono text-[11px] text-muted-foreground space-y-1 overflow-x-auto">
              <div class="text-muted-foreground">— SQL queries ({a.queries.length}) —</div>
              {a.queries.map((q, qi) => (
                <div key={qi} class="flex gap-3">
                  <span class="text-primary/80 shrink-0 tabular">{q.ms}ms</span>
                  <span class="text-muted-foreground truncate">{q.sql}</span>
                </div>
              ))}
              {a.queries.length === 0 ? <div class="text-muted-foreground">no queries</div> : ""}
            </div>
          </td>
        </tr>,
      );
    }
    return rows;
  }
}
