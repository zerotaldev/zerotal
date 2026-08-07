/**
 * Panel — the registry of admin panels, and the facade over the one most
 * applications have:
 *
 *   Panel.configure({ path: "/admin", brand: "Acme" });
 *   Panel.register(UserResource, PostResource);
 *   Panel.pages(ReportsPage);
 *
 * Every static here forwards to {@link Panel.current}, which is the panel whose
 * path prefixes the request being served, and the default panel everywhere else
 * (boot, CLI, tests). An app with a single panel therefore never has to think
 * about instances at all.
 *
 * A second audience gets a second panel:
 *
 *   const app = Panel.make("app", { path: "/app", brand: "Acme Console" });
 *   app.register(InvoiceResource);
 *
 * Each instance owns its resources, pages, widgets, guard and URL prefix, so the
 * two never see each other's registrations.
 *
 * Packages don't call any of this directly. They push into the host bound as
 * `admin.panel` — see `plugin.ts` for that side of the contract.
 */
import { RequestContext } from "@zerotal/core";
import type { AdminConfigShape, AdminAuthConfig } from "./config.ts";
import type { DashboardWidget } from "./widgets/Widget.ts";
import type { NotificationProvider } from "./notifications.ts";
import type { AdminPageClass } from "./pages/AdminPage.ts";
import type { RenderHook, RenderHookName } from "./renderHooks.ts";
import type { SavedViewProvider } from "./savedViews.ts";
import type { MediaProvider } from "./media.ts";
import type { RoleProvider } from "./roles.ts";
import type { DashboardLayoutStore } from "./dashboardLayout.ts";
import { PanelInstance } from "./PanelInstance.ts";
import type { NavGroup, PanelPage, ResourceClass } from "./PanelInstance.ts";
import type {
  AdminPanelHost,
  AdminPlugin,
  ConsoleContribution,
  PanelSearchProvider,
  TopbarSlot,
  UserMenuContribution,
  WidgetContribution,
} from "./plugin.ts";

export { PanelInstance } from "./PanelInstance.ts";
export type { ResourceClass, NavItem, NavGroup, PanelPage } from "./PanelInstance.ts";

/** The id given to the panel every application starts with. */
export const DEFAULT_PANEL_ID = "admin";

export class Panel {
  private static _panels = new Map<string, PanelInstance>();

  // ── The registry ─────────────────────────────────────────────────────────────

  /** The panel every app starts with, created on first use. */
  static default(): PanelInstance {
    let panel = this._panels.get(DEFAULT_PANEL_ID);
    if (!panel) {
      panel = new PanelInstance(DEFAULT_PANEL_ID);
      this._panels.set(DEFAULT_PANEL_ID, panel);
    }
    return panel;
  }

  /**
   * Create (or reconfigure) an additional panel. Give it a path of its own —
   * two panels sharing a prefix cannot be told apart from a URL.
   */
  static make(id: string, config: Partial<AdminConfigShape> = {}): PanelInstance {
    const existing = this._panels.get(id);
    if (existing) {
      existing.configure(config);
      return existing;
    }
    const panel = new PanelInstance(id, config);
    this._panels.set(id, panel);
    return panel;
  }

  /** Resolve a panel by id. */
  static get(id: string): PanelInstance | undefined {
    return this._panels.get(id);
  }

  /** Every registered panel, the default one first. */
  static all(): PanelInstance[] {
    this.default();
    return [...this._panels.values()];
  }

  /**
   * The panel the current request belongs to — the one whose path is the longest
   * matching prefix of the request URL. Off-request (boot, CLI, queue workers,
   * WebSocket actions) this is the default panel, which is also the right answer
   * for the overwhelmingly common single-panel app.
   *
   * Pages generated for a specific panel hold that instance directly rather than
   * asking here, so their WebSocket actions stay on the right panel too.
   */
  static current(): PanelInstance {
    const url = RequestContext.tryGet()?.request.url;
    if (!url || this._panels.size < 2) return this.default();
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      return this.default();
    }
    return this.forPath(path);
  }

  /** The panel owning `path`, or the default panel when none claims it. */
  static forPath(path: string): PanelInstance {
    let best: PanelInstance | undefined;
    for (const panel of this._panels.values()) {
      const base = panel.base();
      if (path !== base && !path.startsWith(`${base}/`)) continue;
      if (!best || base.length > best.base().length) best = panel;
    }
    return best ?? this.default();
  }

  /** Forget every panel (tests). */
  static reset(): void {
    this._panels.clear();
  }

  // ── Facade over the current panel ────────────────────────────────────────────

  static configure(config: Partial<AdminConfigShape>): void {
    this.current().configure(config);
  }

  static config(): AdminConfigShape {
    return this.current().config();
  }

  static register(...resources: ResourceClass[]): void {
    this.current().register(...resources);
  }

  static resources(): ResourceClass[] {
    return this.current().resources();
  }

  static widgets(...widgets: DashboardWidget[]): void {
    this.current().widgets(...widgets);
  }

  static dashboardWidgets(): DashboardWidget[] {
    return this.current().dashboardWidgets();
  }

  static notifications(provider: NotificationProvider): void {
    this.current().notifications(provider);
  }

  static notificationProvider(): NotificationProvider | undefined {
    return this.current().notificationProvider();
  }

  static auth(config: AdminAuthConfig): void {
    this.current().auth(config);
  }

  static authConfig(): AdminAuthConfig | undefined {
    return this.current().authConfig();
  }

  static find(slug: string): ResourceClass | undefined {
    return this.current().find(slug);
  }

  static pages(...pages: AdminPageClass[]): void {
    this.current().pages(...pages);
  }

  static registeredPages(): PanelPage[] {
    return this.current().registeredPages();
  }

  static findPage(slug: string): PanelPage | undefined {
    return this.current().findPage(slug);
  }

  static plugin(...plugins: AdminPlugin[]): Promise<void> {
    return this.current().plugin(...plugins);
  }

  static pluginEnabled(id: string): boolean {
    return this.current().pluginEnabled(id);
  }

  static host(): AdminPanelHost {
    return this.current().host();
  }

  static consoles(): ConsoleContribution[] {
    return this.current().consoles();
  }

  static findConsole(slug: string): ConsoleContribution | undefined {
    return this.current().findConsole(slug);
  }

  static contributedWidgets(): WidgetContribution[] {
    return this.current().contributedWidgets();
  }

  static visibleWidgets(): Promise<DashboardWidget[]> {
    return this.current().visibleWidgets();
  }

  static visibleSearchProviders(): Promise<PanelSearchProvider[]> {
    return this.current().visibleSearchProviders();
  }

  static visibleTopbarSlots(): Promise<TopbarSlot[]> {
    return this.current().visibleTopbarSlots();
  }

  static visibleUserMenuItems(): Promise<UserMenuContribution[]> {
    return this.current().visibleUserMenuItems();
  }

  static savedViews(provider: SavedViewProvider): void {
    this.current().savedViews(provider);
  }

  static savedViewProvider(): SavedViewProvider | undefined {
    return this.current().savedViewProvider();
  }

  static media(provider: MediaProvider, options: { disk?: string } = {}): void {
    this.current().media(provider, options);
  }

  static mediaDisk(): string | undefined {
    return this.current().mediaDisk();
  }

  static mediaProvider(): MediaProvider | undefined {
    return this.current().mediaProvider();
  }

  static roles(provider: RoleProvider): void {
    this.current().roles(provider);
  }

  static roleProvider(): RoleProvider | undefined {
    return this.current().roleProvider();
  }

  static dashboardLayout(store: DashboardLayoutStore): void {
    this.current().dashboardLayout(store);
  }

  static dashboardLayoutStore(): DashboardLayoutStore | undefined {
    return this.current().dashboardLayoutStore();
  }

  static renderHook(name: RenderHookName, hook: RenderHook): void {
    this.current().renderHook(name, hook);
  }

  static renderHooks(name: RenderHookName): RenderHook[] {
    return this.current().renderHooks(name);
  }

  static can(ability: string | undefined): Promise<boolean> {
    return this.current().can(ability);
  }

  static navigationBadges(): Promise<Record<string, { text: string; color: string }>> {
    return this.current().navigationBadges();
  }

  static navigation(): NavGroup[] {
    return this.current().navigation();
  }

  static visibleNavigation(): Promise<NavGroup[]> {
    return this.current().visibleNavigation();
  }
}
