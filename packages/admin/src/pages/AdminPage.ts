/**
 * A custom panel page — anything that belongs in the admin but isn't a Resource:
 * a settings screen, a report, an ops console.
 *
 *   import { AdminPage, Panel } from "@zerotal/admin";
 *
 *   class ReportsPage extends AdminPage {
 *     static override slug = "reports";
 *     static override title = "Reports";
 *     static override navigationIcon = "chart";
 *     static override navigationGroup = "Insights";
 *     static override ability = "reports.view";
 *
 *     override async render() {
 *       return <div>…</div>;
 *     }
 *   }
 *
 *   Panel.pages(ReportsPage);
 *
 * The page is a plain Flow component, so `@expose` state, actions and the
 * WebSocket round-trip all work exactly as they do on a resource page. The panel
 * mounts the route under its own path, applies the panel guard, and adds a
 * sidebar entry — all from the statics above.
 *
 * This is the door for *application* code, which may depend on `@zerotal/admin`.
 * Packages contribute through the container binding instead; see
 * {@link AdminPanelHost}.
 */
import { Component } from "@zerotal/flow";
import { AdminLayout } from "../ui/AdminLayout.tsx";
import type { BadgeTone } from "../table/Column.ts";
import type { ClusterClass } from "../Cluster.ts";

export abstract class AdminPage extends Component {
  static layout = AdminLayout;

  /** Path under the panel root, without a leading slash — `"reports"`, `"settings/billing"`. */
  static slug = "";

  /** Page title, and the sidebar label unless {@link navigationLabel} overrides it. */
  static title = "";

  /** Sidebar label, when it should differ from the title. */
  static navigationLabel?: string;

  /** Icon name from the panel's icon set. */
  static navigationIcon = "layout-grid";

  /** Sidebar group heading. Ungrouped pages sort above every group. */
  static navigationGroup?: string;

  /**
   * The {@link Cluster} this page belongs to. A clustered page shares the
   * cluster's URL segment and sits under its sidebar entry alongside the
   * cluster's resources — so a Shop report lives at `/admin/shop/report`.
   */
  static cluster?: ClusterClass;

  /** Sort weight within the group. Ties break alphabetically. */
  static navigationSort = 0;

  /**
   * Ability required to see the sidebar entry and open the route.
   *
   * Leaving it unset means the page is governed by the panel guard alone — which
   * is a defensible choice for a page the app wrote itself, and is why this is
   * optional here but required for package contributions.
   */
  static ability?: string;

  /** Mount the route but keep the page out of the sidebar. */
  static showInNavigation = true;

  /**
   * A count pill beside the sidebar entry — a pending total, an error count.
   * A failing query is swallowed rather than taking the sidebar down with it.
   */
  static navigationBadge?: () => Promise<string | number | null> | string | number | null;

  /** Tone of the navigation badge. Defaults to `"primary"`. */
  static navigationBadgeColor?: BadgeTone;

  /**
   * Extra route patterns mounted onto this page, relative to {@link slug} — e.g.
   * `[":section"]` so one page serves `/reports` and `/reports/revenue`.
   */
  static routeParams?: string[];

  /** The sidebar label — {@link navigationLabel}, falling back to {@link title}. */
  static getNavigationLabel(): string {
    return this.navigationLabel ?? this.title;
  }
}

/**
 * A concrete {@link AdminPage} subclass — the static metadata above, plus the
 * zero-argument constructor Flow builds the page with.
 */
export type AdminPageClass = typeof AdminPage & (new () => AdminPage);
