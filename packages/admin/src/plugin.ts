/**
 * The panel's contribution surface — how packages other than the app itself add
 * functionality to the admin.
 *
 * The panel is a *host*: it publishes the write surface below, binds it into the
 * container as `admin.panel`, and never names a single contributor. A package
 * contributes by resolving that binding at boot and pushing into it:
 *
 *   // packages/queue/src/admin.ts
 *   interface AdminHost {                       // declared locally — no admin dependency
 *     enabled(id: string): boolean;
 *     page(c: { slug: string; page: unknown; title: string; ability: string }): void;
 *   }
 *
 *   export function installQueueAdmin(app: Application): void {
 *     const panel = app.container.tryMake("admin.panel" as never) as AdminHost | undefined;
 *     if (!panel?.enabled("queue")) return;
 *     panel.page({ slug: "jobs", page: JobsPage, title: "Jobs", ability: "queue.view" });
 *   }
 *
 * Called from the contributing provider's `onBooted`, this is zero-config for the
 * app — installing both providers is enough — and costs nothing when the admin
 * isn't installed, because the binding simply isn't there. It mirrors how the
 * observability sinks are wired, so there is one extension idiom to learn.
 *
 * Apps use the more direct door: an {@link AdminPlugin} passed to `Panel.plugin()`,
 * or an {@link AdminPage} subclass passed to `Panel.pages()`.
 */
import type { HtmlNode } from "@zerotal/flow";
import type { DashboardWidget } from "./widgets/Widget.ts";
import type { BadgeTone } from "./table/Column.ts";
import type { ClusterClass } from "./Cluster.ts";
import type { RenderHookContext } from "./renderHooks.ts";

/**
 * A page component class, structurally — a Flow `Component` subclass.
 *
 * Typed as a bare zero-argument constructor on purpose. It's what Flow's router
 * actually does with a page class, and it lets a contributing package hand one
 * over without importing anything from `@zerotal/admin`. The panel gives the page
 * its own layout when it mounts the route, so a contributed page renders only its
 * content and inherits the panel's chrome.
 *
 * @internal
 */
export type PanelPageClass = new () => object;

/**
 * A page contributed by a package.
 *
 * `ability` is **required** here, unlike on an app-authored {@link AdminPage}.
 * Contributions register themselves without the app asking, so the ability is the
 * only thing standing between a package's page and every user who can reach the
 * panel — a contributed page with no ability would be a package deciding who sees
 * production internals, which is not the package's decision to make.
 */
export interface PageContribution {
  /** Path under the panel root, without leading slash — `"jobs"`, `"monitor/requests"`. */
  slug: string;
  /** The page component class. Mounted with the panel's layout and guard. */
  page: PanelPageClass;
  /** Page title, and the navigation label unless `navigationLabel` overrides it. */
  title: string;
  /** Ability required to see the nav entry and open the route. */
  ability: string;
  /** Sidebar label, when it should differ from the title. */
  navigationLabel?: string;
  /** Icon name from the panel's icon set. */
  navigationIcon?: string;
  /** Sidebar group heading. Ungrouped entries sort above every group. */
  navigationGroup?: string;
  /** A cluster to file this page under, sharing its URL segment and nav entry. */
  cluster?: ClusterClass;
  /** Sort weight within the group. Ties break alphabetically. */
  navigationSort?: number;
  /** Mount the route but keep it out of the sidebar (detail pages, drill-ins). */
  showInNavigation?: boolean;
  /**
   * Extra route patterns mounted onto the same page, relative to `slug` — e.g.
   * `[":section"]` so one page serves `/jobs` and `/jobs/failed`.
   */
  routeParams?: string[];
  /** A count pill beside the sidebar entry. Failures are swallowed. */
  navigationBadge?: () => Promise<string | number | null> | string | number | null;
  /** Tone of the navigation badge. */
  navigationBadgeColor?: BadgeTone;
}

// ── Consoles ─────────────────────────────────────────────────────────────────

/**
 * A row in a console table — whatever shape the contributing package hands over.
 */
export type ConsoleRow = Record<string, unknown>;

/** One column of a console table. */
export interface ConsoleColumn {
  /** Property read from the row. */
  key: string;
  label: string;
  align?: "start" | "center" | "end";
  /** Render in a monospace face — ids, class names, error text. */
  mono?: boolean;
  /** Turn the raw value into display text. Defaults to `String(value)`. */
  format?: (value: unknown, row: ConsoleRow) => string;
  /** Render the cell as a badge in this tone, or `null` for plain text. */
  badge?: (value: unknown, row: ConsoleRow) => BadgeTone | null;
}

/** An action offered on every row of a console table. */
export interface ConsoleAction {
  key: string;
  label: string;
  icon?: string;
  danger?: boolean;
  /** Ask for confirmation with this message before running. */
  confirm?: string;
  /** Run against one row. Return a message to flash on success. */
  run: (row: ConsoleRow) => Promise<string | void> | string | void;
}

/** An action in a console tab's header — operating on the tab, not on a row. */
export interface ConsoleHeaderAction {
  key: string;
  label: string;
  icon?: string;
  danger?: boolean;
  confirm?: string;
  run: () => Promise<string | void> | string | void;
}

/** One tab of a console — a table, plus what can be done to it. */
export interface ConsoleTab {
  key: string;
  label: string;
  /** Explanatory line under the heading. */
  description?: string;
  columns: ConsoleColumn[];
  rows: () => Promise<ConsoleRow[]> | ConsoleRow[];
  /** Property identifying a row, used for morph keys. Defaults to `"id"`. */
  rowKey?: string;
  rowActions?: ConsoleAction[];
  headerActions?: ConsoleHeaderAction[];
  /** Shown in place of an empty table. */
  empty?: string;
  /** A count pill on the tab itself. */
  badge?: () => Promise<number | null> | number | null;
}

/**
 * A read-and-act page described as data rather than built as a component.
 *
 * Most packages want the same page: some tables, a few buttons, no bespoke
 * layout. Describing that instead of rendering it means the contributing package
 * needs no JSX, no `@zerotal/flow` dependency and no build configuration —
 * the panel owns the markup, so every console also looks like the rest of the
 * admin without trying to.
 *
 * Reach for {@link PageContribution} instead when a page genuinely needs its own
 * component: charts, a custom layout, its own reactive state.
 */
export interface ConsoleContribution {
  /** Path under the panel root, without leading slash. */
  slug: string;
  title: string;
  /** Ability required to see the nav entry and open the route. */
  ability: string;
  tabs: ConsoleTab[];
  navigationLabel?: string;
  navigationIcon?: string;
  navigationGroup?: string;
  navigationSort?: number;
  showInNavigation?: boolean;
  /** A count pill beside the sidebar entry. Failures are swallowed. */
  navigationBadge?: () => Promise<string | number | null> | string | number | null;
  /** Tone of the navigation badge. */
  navigationBadgeColor?: BadgeTone;
}

/** A dashboard widget contributed by a package. */
export interface WidgetContribution {
  widget: DashboardWidget;
  /** Ability required to see this widget on the dashboard. */
  ability: string;
  /** Sort weight among contributed widgets. Lower renders first. */
  sort?: number;
}

/** A sidebar link that points somewhere the panel doesn't mount itself. */
export interface NavContribution {
  label: string;
  href: string;
  icon?: string;
  group?: string;
  sort?: number;
  /** Ability required to see the link. */
  ability: string;
  /** Open in a new tab and skip client-side navigation. */
  external?: boolean;
}

/** One result row from a contributed search provider. */
export interface SearchHit {
  label: string;
  href: string;
  description?: string;
}

/**
 * A source of global-search results beyond the registered resources — log lines,
 * jobs, audit entries, anything with a stable URL.
 */
export interface PanelSearchProvider {
  /** Stable id, used for the opt-out check and as the result group key. */
  id: string;
  /** Group heading shown above this provider's hits. */
  label: string;
  icon?: string;
  /** Ability required to search this source. */
  ability: string;
  search(term: string): Promise<SearchHit[]> | SearchHit[];
}

/** A status pill, indicator, or control rendered in the panel's top bar. */
export interface TopbarSlot {
  id: string;
  /** Ability required to render the slot. */
  ability: string;
  /** Lower renders further left. */
  sort?: number;
  render(): HtmlNode | Promise<HtmlNode>;
}

/** An extra entry in the top-bar user menu. */
export interface UserMenuContribution {
  label: string;
  href: string;
  icon?: string;
  sort?: number;
  /** Ability required to see the entry. */
  ability: string;
}

/**
 * The panel's write surface, bound into the container as `admin.panel`.
 *
 * Contributors should declare their own minimal copy of the members they use
 * rather than importing this type, so they depend on the admin package at build
 * time not at all.
 *
 * @internal
 */
export interface AdminPanelHost {
  /**
   * Whether the app has left this contributor switched on. Check it first and
   * return early — `plugins: { monitor: false }` in `config/admin.ts` turns a
   * contributor off without uninstalling its provider.
   */
  enabled(id: string): boolean;
  page(contribution: PageContribution): void;
  /**
   * Add a table-and-actions page described as data. The cheaper door — no
   * component, no JSX, no dependency on Flow.
   */
  console(contribution: ConsoleContribution): void;
  widget(contribution: WidgetContribution): void;
  navItem(contribution: NavContribution): void;
  searchProvider(provider: PanelSearchProvider): void;
  topbarSlot(slot: TopbarSlot): void;
  userMenuItem(item: UserMenuContribution): void;
  /**
   * Render into a named position in the panel's chrome — a banner above every
   * table, a notice under every form. See `RenderHookName` for the positions.
   */
  renderHook(name: string, hook: (context: RenderHookContext) => HtmlNode | string | null): void;
}

/**
 * The app-side door into the same registry. Where a package pushes itself in via
 * the container binding, an app names what it wants:
 *
 *   Panel.plugin({ id: "billing", install: (panel) => panel.page({ … }) });
 */
export interface AdminPlugin {
  id: string;
  install(panel: AdminPanelHost): void | Promise<void>;
}
