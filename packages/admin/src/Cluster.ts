/**
 * Cluster — a named section of the panel that owns a group of resources and
 * pages, giving them a shared URL segment and a single sidebar entry.
 *
 * A panel with thirty resources spread across three business areas is easier to
 * navigate as three clusters than as one long list. Members declare which
 * cluster they belong to; the panel does the rest:
 *
 *   export class ShopCluster extends Cluster {
 *     static override slug = "shop";
 *     static override title = "Shop";
 *     static override navigationIcon = "collection";
 *   }
 *
 *   export class ProductResource extends Resource {
 *     static override cluster = ShopCluster;   // → /admin/shop/products
 *   }
 *
 * The cluster's own `ability` gates the whole section: deny it and every member
 * disappears from the sidebar and refuses its route, without each member having
 * to repeat the check.
 */
export abstract class Cluster {
  /** URL segment the cluster's members live under. */
  static slug: string;
  /** Heading shown for the cluster in navigation and breadcrumbs. */
  static title: string;
  /** Sidebar label, when it should differ from the title. */
  static navigationLabel?: string;
  /** Navigation icon key (see `ui/icons.ts`). */
  static navigationIcon = "layout-grid";
  /** Optional sidebar group the cluster itself sits in. */
  static navigationGroup?: string;
  /** Sort order within the sidebar (lower = higher). */
  static navigationSort = 0;
  /** Ability gating the whole cluster, checked for the entry and every route. */
  static ability?: string;

  static getNavigationLabel(): string {
    return this.navigationLabel ?? this.title;
  }

  /** The cluster's URL prefix under a panel base. */
  static url(base: string): string {
    return `${base}/${this.slug}`;
  }
}

/**
 * A Cluster subclass (used by its static surface — never instantiated).
 *
 * @internal
 */
export type ClusterClass = typeof Cluster;
