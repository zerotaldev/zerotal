/**
 * PanelInstance — one admin panel: its configuration, its resources, its custom
 * pages, its dashboard widgets, and everything other packages contributed to it.
 * The sidebar, the routes and the command palette are all derived from what is
 * registered here.
 *
 * An application usually has exactly one, reached through the {@link Panel}
 * facade. Apps that serve two audiences from one codebase — a staff back office
 * at `/admin` and a customer console at `/app` — create additional instances
 * with `Panel.make()`; each keeps its own registry, path prefix and guard.
 *
 * Packages never touch an instance directly. They push into {@link host}, which
 * `AdminProvider` binds into the container as `admin.panel` — see `plugin.ts`
 * for that side of the contract.
 */
import type { Resource } from "./Resource.ts";
import type { ClusterClass } from "./Cluster.ts";
import type { RenderHook, RenderHookName } from "./renderHooks.ts";
import type { SavedViewProvider } from "./savedViews.ts";
import type { MediaProvider } from "./media.ts";
import type { RoleProvider } from "./roles.ts";
import type { DashboardLayoutStore } from "./dashboardLayout.ts";
import { type AdminConfigShape, type AdminAuthConfig, DEFAULT_ADMIN_CONFIG } from "./config.ts";
import type { DashboardWidget } from "./widgets/Widget.ts";
import type { NotificationProvider } from "./notifications.ts";
import type { AdminPageClass } from "./pages/AdminPage.ts";
import type { BadgeTone } from "./table/Column.ts";
import { resolveAbility } from "./support/ability.ts";
import type {
  AdminPanelHost,
  AdminPlugin,
  ConsoleContribution,
  NavContribution,
  PageContribution,
  PanelPageClass,
  PanelSearchProvider,
  TopbarSlot,
  UserMenuContribution,
  WidgetContribution,
} from "./plugin.ts";

/** A Resource subclass (used by its static surface — never instantiated). */
export type ResourceClass = typeof Resource;

/** A custom page's path under the panel base, including any cluster segment. */
export function pagePath(page: Pick<PanelPage, "slug" | "cluster">): string {
  return page.cluster ? `${page.cluster.slug}/${page.slug}` : page.slug;
}

export interface NavItem {
  label: string;
  slug: string;
  icon: string;
  href: string;
  sort: number;
  /** Parent item's label (for nested navigation). */
  parent?: string | undefined;
  /** Nested child items (resolved from `navigationParentItem`). */
  children?: NavItem[];
  /** Ability gating this entry, when it has one. */
  ability?: string | undefined;
  /** Link out of the panel rather than navigating within it. */
  external?: boolean | undefined;
}

export interface NavGroup {
  group: string | null;
  items: NavItem[];
}

/**
 * A registered custom page, normalized from either door — an {@link AdminPage}
 * subclass registered by the app, or a {@link PageContribution} pushed in by a
 * package.
 *
 * @internal
 */
export interface PanelPage {
  slug: string;
  page: PanelPageClass;
  title: string;
  ability: string | undefined;
  /** The cluster this page belongs to, when it has one. */
  cluster?: ClusterClass | undefined;
  navigationLabel: string;
  navigationIcon: string;
  navigationGroup: string | undefined;
  navigationSort: number;
  showInNavigation: boolean;
  routeParams: string[];
  navigationBadge?: (() => Promise<string | number | null> | string | number | null) | undefined;
  navigationBadgeColor?: BadgeTone | undefined;
}

export class PanelInstance {
  /** Stable identifier, used for route naming and shell identity. */
  readonly id: string;

  private _resources: ResourceClass[] = [];
  private _config: AdminConfigShape;
  private _widgets: DashboardWidget[] = [];
  private _notifications?: NotificationProvider | undefined;
  private _pages: PanelPage[] = [];
  private _consoles: ConsoleContribution[] = [];
  private _contributedWidgets: WidgetContribution[] = [];
  private _navItems: NavContribution[] = [];
  private _searchProviders: PanelSearchProvider[] = [];
  private _topbarSlots: TopbarSlot[] = [];
  private _userMenuItems: UserMenuContribution[] = [];
  private _renderHooks = new Map<RenderHookName, RenderHook[]>();
  private _savedViews?: SavedViewProvider | undefined;
  private _media?: MediaProvider | undefined;
  private _mediaDisk?: string | undefined;
  private _roles?: RoleProvider | undefined;
  private _layout?: DashboardLayoutStore | undefined;

  constructor(id: string, config: Partial<AdminConfigShape> = {}) {
    this.id = id;
    this._config = { ...DEFAULT_ADMIN_CONFIG, ...config };
  }

  /** Merge in panel configuration. */
  configure(config: Partial<AdminConfigShape>): void {
    this._config = { ...this._config, ...config };
  }

  config(): AdminConfigShape {
    return this._config;
  }

  /** The panel's URL prefix, without a trailing slash. */
  base(): string {
    return this._config.path.replace(/\/$/, "");
  }

  /** Register one or more resources (idempotent by slug). */
  register(...resources: ResourceClass[]): void {
    for (const r of resources) {
      if (!this._resources.some((x) => x.getSlug() === r.getSlug())) {
        this._resources.push(r);
      }
    }
  }

  resources(): ResourceClass[] {
    return this._resources;
  }

  /** Register dashboard widgets (stats overview and/or charts). */
  widgets(...widgets: DashboardWidget[]): void {
    this._widgets.push(...widgets);
  }

  dashboardWidgets(): DashboardWidget[] {
    return this._widgets;
  }

  /** Wire up the notification center (app supplies the data). */
  notifications(provider: NotificationProvider): void {
    this._notifications = provider;
  }

  notificationProvider(): NotificationProvider | undefined {
    return this._notifications;
  }

  /** Enable + configure the built-in auth pages (login / profile / reset / verify). */
  auth(config: AdminAuthConfig): void {
    this._config = { ...this._config, auth: { enabled: true, ...config } };
  }

  /** The resolved auth-pages config (or undefined when not enabled). */
  authConfig(): AdminAuthConfig | undefined {
    return this._config.auth?.enabled ? this._config.auth : undefined;
  }

  /** Wire up saved list views (app supplies the storage). */
  savedViews(provider: SavedViewProvider): void {
    this._savedViews = provider;
  }

  /** The saved-view provider, or undefined when the app configured none. */
  savedViewProvider(): SavedViewProvider | undefined {
    return this._savedViews;
  }

  /**
   * Wire up the media library (app supplies the catalogue).
   *
   * `disk` names the storage disk files are written to and read back from. It
   * matters which: the default disk is private and has no URL, so a library
   * left on it stores uploads successfully and shows broken images for every
   * one of them.
   */
  media(provider: MediaProvider, options: { disk?: string } = {}): void {
    this._media = provider;
    this._mediaDisk = options.disk;
  }

  /** The disk the media library reads and writes, or undefined for the default. */
  mediaDisk(): string | undefined {
    return this._mediaDisk;
  }

  /** The media provider, or undefined when the app configured none. */
  mediaProvider(): MediaProvider | undefined {
    return this._media;
  }

  /** Wire up the roles and permissions page (app supplies the storage). */
  roles(provider: RoleProvider): void {
    this._roles = provider;
  }

  /** The role provider, or undefined when the app configured none. */
  roleProvider(): RoleProvider | undefined {
    return this._roles;
  }

  /** Let each user arrange the dashboard (app supplies the storage). */
  dashboardLayout(store: DashboardLayoutStore): void {
    this._layout = store;
  }

  /** The dashboard layout store, or undefined when the app configured none. */
  dashboardLayoutStore(): DashboardLayoutStore | undefined {
    return this._layout;
  }

  /** Resolve a resource by its URL slug. */
  find(slug: string): ResourceClass | undefined {
    return this._resources.find((r) => r.getSlug() === slug);
  }

  // ── Custom pages ─────────────────────────────────────────────────────────────

  /**
   * Register one or more {@link AdminPage} subclasses (idempotent by slug).
   *
   * This is the app-facing door. Packages contribute through {@link host}
   * instead, so they need no dependency on this one.
   */
  pages(...pages: AdminPageClass[]): void {
    for (const p of pages) {
      this._addPage({
        slug: p.slug.replace(/^\/|\/$/g, ""),
        page: p,
        title: p.title,
        ability: p.ability,
        cluster: p.cluster,
        navigationLabel: p.getNavigationLabel(),
        navigationIcon: p.navigationIcon,
        navigationGroup: p.navigationGroup,
        navigationSort: p.navigationSort,
        showInNavigation: p.showInNavigation,
        routeParams: p.routeParams ?? [],
        navigationBadge: p.navigationBadge ? () => p.navigationBadge!() : undefined,
        navigationBadgeColor: p.navigationBadgeColor,
      });
    }
  }

  /** Every registered custom page, from both doors. */
  registeredPages(): PanelPage[] {
    return this._pages;
  }

  /** Resolve a custom page by its slug. */
  findPage(slug: string): PanelPage | undefined {
    return this._pages.find((p) => p.slug === slug);
  }

  private _addPage(page: PanelPage): void {
    if (this._pages.some((p) => p.slug === page.slug)) return;
    this._pages.push(page);
  }

  // ── Contributions ────────────────────────────────────────────────────────────

  /**
   * Install an app-authored plugin. The mirror of what a package does through the
   * `admin.panel` binding, for code that can name the panel directly.
   */
  async plugin(...plugins: AdminPlugin[]): Promise<void> {
    for (const p of plugins) {
      if (this.pluginEnabled(p.id)) await p.install(this.host());
    }
  }

  /**
   * Whether a contributor is switched on. Contributors are on unless the app
   * turns them off with `plugins: { monitor: false }` in `config/admin.ts`.
   */
  pluginEnabled(id: string): boolean {
    return this._config.plugins?.[id] !== false;
  }

  /**
   * The panel's write surface, bound into the container as `admin.panel`.
   *
   * Contributions are appended, never deduplicated by identity — a provider that
   * boots twice in one process (some test harnesses do) would double up, so each
   * registrar guards on the natural key where it has one.
   */
  host(): AdminPanelHost {
    return {
      enabled: (id) => this.pluginEnabled(id),
      page: (c: PageContribution) =>
        this._addPage({
          slug: c.slug.replace(/^\/|\/$/g, ""),
          page: c.page,
          title: c.title,
          ability: c.ability,
          cluster: c.cluster,
          navigationLabel: c.navigationLabel ?? c.title,
          navigationIcon: c.navigationIcon ?? "layout-grid",
          navigationGroup: c.navigationGroup,
          navigationSort: c.navigationSort ?? 0,
          showInNavigation: c.showInNavigation ?? true,
          routeParams: c.routeParams ?? [],
          navigationBadge: c.navigationBadge,
          navigationBadgeColor: c.navigationBadgeColor,
        }),
      console: (c: ConsoleContribution) => {
        const slug = c.slug.replace(/^\/|\/$/g, "");
        if (this._consoles.some((x) => x.slug === slug)) return;
        this._consoles.push({ ...c, slug });
      },
      widget: (c) => {
        this._contributedWidgets.push(c);
      },
      navItem: (c) => {
        if (!this._navItems.some((n) => n.href === c.href)) this._navItems.push(c);
      },
      searchProvider: (p) => {
        if (!this._searchProviders.some((s) => s.id === p.id)) this._searchProviders.push(p);
      },
      topbarSlot: (s) => {
        if (!this._topbarSlots.some((t) => t.id === s.id)) this._topbarSlots.push(s);
      },
      renderHook: (name, hook) => {
        this.renderHook(name as RenderHookName, hook as RenderHook);
      },
      userMenuItem: (i) => {
        if (!this._userMenuItems.some((u) => u.href === i.href)) this._userMenuItems.push(i);
      },
    };
  }

  /**
   * Render something at a named position in the panel's chrome. See
   * {@link RenderHookName} for the positions.
   */
  renderHook(name: RenderHookName, hook: RenderHook): void {
    const list = this._renderHooks.get(name) ?? [];
    list.push(hook);
    this._renderHooks.set(name, list);
  }

  /** Hooks registered at `name`, in registration order. */
  renderHooks(name: RenderHookName): RenderHook[] {
    return this._renderHooks.get(name) ?? [];
  }

  /** Every registered console. */
  consoles(): ConsoleContribution[] {
    return this._consoles;
  }

  /** Resolve a console by its slug. */
  findConsole(slug: string): ConsoleContribution | undefined {
    return this._consoles.find((c) => c.slug === slug);
  }

  /** Contributed dashboard widgets, in sort order. Not ability-filtered — see {@link visibleWidgets}. */
  contributedWidgets(): WidgetContribution[] {
    return [...this._contributedWidgets].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  }

  /** Contributed dashboard widgets the current user may see. */
  async visibleWidgets(): Promise<DashboardWidget[]> {
    const allowed = await this._filterByAbility(this.contributedWidgets(), (w) => w.ability);
    return allowed.map((w) => w.widget);
  }

  /** Contributed global-search providers the current user may query. */
  visibleSearchProviders(): Promise<PanelSearchProvider[]> {
    return this._filterByAbility(this._searchProviders, (p) => p.ability);
  }

  /** Contributed top-bar slots the current user may see, in sort order. */
  visibleTopbarSlots(): Promise<TopbarSlot[]> {
    const sorted = [...this._topbarSlots].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    return this._filterByAbility(sorted, (s) => s.ability);
  }

  /** Contributed user-menu entries the current user may see, in sort order. */
  visibleUserMenuItems(): Promise<UserMenuContribution[]> {
    const sorted = [...this._userMenuItems].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    return this._filterByAbility(sorted, (i) => i.ability);
  }

  // ── Authorization ────────────────────────────────────────────────────────────

  /**
   * Whether the current user holds `ability`, resolved through the app's
   * `authorize` hook, then the `gate` binding, then a fail-closed default.
   *
   * Resources are *not* filtered through here — they authorize through their own
   * `Resource.can("viewAny")`, which carries record context this cannot.
   */
  can(ability: string | undefined): Promise<boolean> {
    return resolveAbility(ability, this._config.authorize);
  }

  /** Keep the entries whose ability the current user holds, preserving order. */
  private async _filterByAbility<T>(
    items: T[],
    abilityOf: (item: T) => string | undefined,
  ): Promise<T[]> {
    const verdicts = await Promise.all(items.map((i) => this.can(abilityOf(i))));
    return items.filter((_, i) => verdicts[i] === true);
  }

  /**
   * Resolve every resource's sidebar navigation badge, keyed by slug. Failures
   * are swallowed so a broken badge query never takes down the whole sidebar.
   */
  async navigationBadges(): Promise<Record<string, { text: string; color: string }>> {
    const out: Record<string, { text: string; color: string }> = {};
    const record = async (
      slug: string,
      resolve: () => Promise<string | number | null> | string | number | null,
      color: BadgeTone,
    ): Promise<void> => {
      try {
        const b = await resolve();
        if (b !== null && b !== undefined && b !== "") out[slug] = { text: String(b), color };
      } catch {
        /* ignore a failing badge query */
      }
    };

    await Promise.all([
      ...this._resources.map((r) =>
        record(r.getSlug(), () => r.navigationBadge(), r.navigationBadgeColor),
      ),
      ...this._pages
        .filter((p) => p.navigationBadge)
        .map((p) => record(p.slug, p.navigationBadge!, p.navigationBadgeColor ?? "primary")),
      ...this._consoles
        .filter((c) => c.navigationBadge)
        .map((c) => record(c.slug, c.navigationBadge!, c.navigationBadgeColor ?? "primary")),
    ]);
    return out;
  }

  /** Reset the registry (tests). */
  reset(): void {
    this._resources = [];
    this._config = { ...DEFAULT_ADMIN_CONFIG };
    this._widgets = [];
    this._notifications = undefined;
    this._pages = [];
    this._consoles = [];
    this._contributedWidgets = [];
    this._navItems = [];
    this._searchProviders = [];
    this._topbarSlots = [];
    this._userMenuItems = [];
    this._renderHooks.clear();
    this._savedViews = undefined;
    this._media = undefined;
    this._mediaDisk = undefined;
    this._roles = undefined;
    this._layout = undefined;
  }

  /**
   * Build the sidebar navigation, grouped and sorted — resources, custom pages
   * and contributed links together.
   *
   * Entries are *not* ability-filtered here; this is the full map, used for route
   * mounting and tests. What a given user may see is {@link visibleNavigation}.
   */
  navigation(): NavGroup[] {
    const base = this.base();
    const groups = new Map<string | null, NavItem[]>();
    const push = (group: string | null, item: NavItem): void => {
      const list = groups.get(group) ?? [];
      list.push(item);
      groups.set(group, list);
    };

    // Clustered members collect under one entry rather than appearing loose in
    // the sidebar; the cluster is keyed by identity so two with the same title
    // stay distinct.
    const clustered = new Map<ClusterClass, NavItem[]>();

    for (const r of this._resources) {
      // A nested resource is reached through its parent's records, not from the
      // sidebar — there is no single URL for "all comments of every post".
      if (r.parent) continue;
      const item: NavItem = {
        label: r.getPluralLabel(),
        slug: r.getSlug(),
        icon: r.navigationIcon,
        href: r.indexUrl(base),
        sort: r.navigationSort,
        parent: r.navigationParentItem,
      };
      if (r.cluster) {
        const members = clustered.get(r.cluster) ?? [];
        members.push(item);
        clustered.set(r.cluster, members);
      } else {
        push(r.navigationGroup ?? null, item);
      }
    }

    for (const p of this._pages) {
      if (!p.showInNavigation) continue;
      const item: NavItem = {
        label: p.navigationLabel,
        slug: p.slug,
        icon: p.navigationIcon,
        href: `${base}/${pagePath(p)}`,
        sort: p.navigationSort,
        ability: p.ability,
      };
      if (p.cluster) {
        const members = clustered.get(p.cluster) ?? [];
        members.push(item);
        clustered.set(p.cluster, members);
      } else {
        push(p.navigationGroup ?? null, item);
      }
    }

    for (const c of this._consoles) {
      if (c.showInNavigation === false) continue;
      push(c.navigationGroup ?? null, {
        label: c.navigationLabel ?? c.title,
        slug: c.slug,
        icon: c.navigationIcon ?? "layout-grid",
        href: `${base}/${c.slug}`,
        sort: c.navigationSort ?? 0,
        ability: c.ability,
      });
    }

    for (const n of this._navItems) {
      push(n.group ?? null, {
        label: n.label,
        slug: n.href,
        icon: n.icon ?? "layout-grid",
        href: n.href,
        sort: n.sort ?? 0,
        ability: n.ability,
        external: n.external,
      });
    }

    // Each cluster becomes one entry whose children are its members. The entry
    // links to its first member, since a cluster is a grouping rather than a
    // destination of its own.
    for (const [cluster, members] of clustered) {
      members.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
      push(cluster.navigationGroup ?? null, {
        label: cluster.getNavigationLabel(),
        slug: cluster.slug,
        icon: cluster.navigationIcon,
        href: members[0]?.href ?? cluster.url(base),
        sort: cluster.navigationSort,
        ability: cluster.ability,
        children: members,
      });
    }

    const sortItems = (a: NavItem, b: NavItem): number =>
      a.sort - b.sort || a.label.localeCompare(b.label);

    const result: NavGroup[] = [];
    for (const [group, items] of groups) {
      // Nest items declaring a `parent` under the matching label; others stay top-level.
      const byLabel = new Map(items.map((i) => [i.label, i]));
      const top: NavItem[] = [];
      for (const i of items) {
        const parent = i.parent ? byLabel.get(i.parent) : undefined;
        if (parent && parent !== i) (parent.children ??= []).push(i);
        else top.push(i);
      }
      top.sort(sortItems);
      for (const t of top) t.children?.sort(sortItems);
      result.push({ group, items: top });
    }
    // Ungrouped first, then groups alphabetically.
    result.sort((a, b) => {
      if (a.group === null) return -1;
      if (b.group === null) return 1;
      return a.group.localeCompare(b.group);
    });
    return result;
  }

  /**
   * The navigation as the current user may see it: entries whose ability they
   * lack are dropped, along with any group left empty.
   *
   * Resource entries are filtered by `Resource.can("viewAny")`; page and
   * contributed entries by their declared ability. A parent whose ability is
   * denied takes its children with it.
   */
  async visibleNavigation(): Promise<NavGroup[]> {
    const resourceBySlug = new Map(this._resources.map((r) => [r.getSlug(), r]));

    const allowed = async (item: NavItem): Promise<boolean> => {
      const resource = resourceBySlug.get(item.slug);
      if (resource) {
        try {
          return resource.can("viewAny");
        } catch {
          return false;
        }
      }
      return this.can(item.ability);
    };

    const groups: NavGroup[] = [];
    for (const group of this.navigation()) {
      const items: NavItem[] = [];
      for (const item of group.items) {
        if (!(await allowed(item))) continue;
        if (item.children?.length) {
          const children: NavItem[] = [];
          for (const child of item.children) if (await allowed(child)) children.push(child);
          items.push({ ...item, children });
        } else {
          items.push(item);
        }
      }
      if (items.length > 0) groups.push({ group: group.group, items });
    }
    return groups;
  }
}
