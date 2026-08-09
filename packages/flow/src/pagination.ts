// ── In-memory pagination ──────────────────────────────────────────────────────
//
// Pairs with `@expose @url page` to paginate an in-memory array (filtered/derived
// data) inside render() or onMount(). For database queries, prefer the ORM's
// query builder `.paginate(perPage, page)` — this helper is for arrays you already
// hold in memory. The result shape mirrors the ORM paginator for consistency.

/**
 * The result of paginating an in-memory array — one page of `data` plus the
 * surrounding metadata a view needs to render a pager.
 *
 * The shape intentionally mirrors the ORM query builder's paginator, so a
 * template can consume either interchangeably.
 *
 * @typeParam T - Element type of the paginated array.
 *
 * @example
 * ```ts
 * const page = paginate(posts, 2, 10);
 * page.data;         // the 10 items on page 2
 * page.from;         // 11
 * page.hasMorePages; // true if a page 3 exists
 * page.elements();   // [1, 2, 3, '...', 20]
 * ```
 */
export interface Paginator<T> {
  /**
   * The items on the current page (a slice of the input array).
   * @category Access
   */
  data: T[];
  /**
   * Total item count across all pages.
   * @category Metadata
   */
  total: number;
  /**
   * Items per page (the effective, floored value; at least 1).
   * @category Metadata
   */
  perPage: number;
  /**
   * Current page (1-based, clamped to a valid range).
   * @category Metadata
   */
  page: number;
  /**
   * Last page number (>= 1; 1 even when there are no items).
   * @category Metadata
   */
  lastPage: number;
  /**
   * 1-based index of the first item on this page (0 when empty).
   * @category Metadata
   */
  from: number;
  /**
   * 1-based index of the last item on this page (0 when empty).
   * @category Metadata
   */
  to: number;
  /**
   * True when on page 1.
   * @category Metadata
   */
  onFirstPage: boolean;
  /**
   * True when a further page exists.
   * @category Metadata
   */
  hasMorePages: boolean;
  /**
   * Page-number window for rendering a numbered pager, with `'...'` gaps —
   * e.g. `[1, '...', 4, 5, 6, '...', 20]`. The first and last pages are always
   * included.
   *
   * @param each - How many page links to show on each side of the current page (default `1`).
   * @returns A list of page numbers interleaved with `'...'` for elided ranges.
   * @category Navigation
   */
  elements(each?: number): (number | "...")[];
}

/**
 * Paginate an in-memory array — the array counterpart to the ORM's
 * `.paginate(perPage, page)`. Use this for filtered/derived data you already
 * hold in memory (e.g. inside `render()` or `onMount()`); for database queries
 * prefer the query builder's paginator.
 *
 * `page` is clamped into `[1, lastPage]` and `perPage` is floored to at least 1,
 * so out-of-range input never throws.
 *
 * @typeParam T - Element type of `items`.
 * @param items - The full, already-in-memory collection to page over.
 * @param page - 1-based page to return (clamped; default `1`).
 * @param perPage - Items per page (floored to >= 1; default `15`).
 * @returns A {@link Paginator} for the requested page.
 *
 * @example
 * ```ts
 * const results = posts.filter((p) => p.published);
 * const page = paginate(results, this.page, 10);
 * for (const post of page.data) { ... }
 * ```
 */
export function paginate<T>(items: T[], page = 1, perPage = 15): Paginator<T> {
  const total = items.length;
  perPage = Math.max(1, Math.floor(perPage));
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const currentPage = Math.min(Math.max(1, Math.floor(page) || 1), lastPage);
  const offset = (currentPage - 1) * perPage;
  const data = items.slice(offset, offset + perPage);
  return {
    data,
    total,
    perPage,
    page: currentPage,
    lastPage,
    from: total === 0 ? 0 : offset + 1,
    to: offset + data.length,
    onFirstPage: currentPage <= 1,
    hasMorePages: currentPage < lastPage,
    elements(each = 1) {
      return pageElements(currentPage, lastPage, each);
    },
  };
}

// ── Pagination mixin ──────────────────────────────────────────────────────────
//
// The TypeScript equivalent of Livewire's `WithPagination` trait: compose it onto a
// component to add a URL-synced `page` plus page-navigation methods (`nextPage`,
// `previousPage`, `gotoPage`, `resetPage`), WITHOUT putting any of that on
// the base Component.
//
//   class PostsPage extends Component.using(Pagination) {
//     @locked posts: Post[] = [];
//     async onMount() { this.posts = await Post.all(); }
//     async render() {
//       const posts = await Post.paginate(10);      // uses this.page
//       return <div>…{p.data.map(…)}… pager with this.nextPage / ?page= links</div>;
//     }
//   }
//
// `page` is @expose + @url (in the snapshot, synced to ?page=). The nav methods are
// @expose, so they're callable from the browser (onClick={this.nextPage}). Decorators
// applied here register on the mixin's prototype, which the component's prototype-chain
// walk already traverses — so it "just works".
//
// Named paginators (Livewire's `pageName`): every nav method accepts an optional page
// name so a single page can drive more than one independent paginator —
// `this.nextPage("invoices")`, `Invoice.paginate(10, undefined, "invoices")`. The default
// paginator ("page") is the URL-synced one; named paginators live in the snapshot.
//
// Optional update hooks fire around a page change, mirroring Livewire — define any of
// `updatingPage(page, name)` / `updatedPage(page, name)` (default paginator) or the
// generic `updatingPaginators(page, name)` / `updatedPaginators(page, name)`.

import { Component } from "./Component.ts";
import { expose, url } from "./decorators.ts";
import { setCurrentPageResolver, pageElements, type HttpContext } from "@zerotal/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AbstractComponentCtor = abstract new (...args: any[]) => Component;

/** Optional, user-defined pagination lifecycle hooks (all optional). */
interface PaginationHooks {
  updatingPage?(page: number, pageName: string): void;
  updatedPage?(page: number, pageName: string): void;
  updatingPaginators?(page: number, pageName: string): void;
  updatedPaginators?(page: number, pageName: string): void;
}

const DEFAULT_PAGE = "page";

/**
 * Component mixin that adds URL-synced pagination state and navigation actions —
 * flow's equivalent of Livewire's `WithPagination` trait.
 *
 * @remarks
 * Composing this onto a component adds:
 * - a `page` field, `@expose`d and `@url`-synced to the `?page=` query string;
 * - a `paginators` map holding the page of each NAMED paginator (snapshot-only),
 *   so a single component can drive several independent pagers by passing a
 *   `pageName` (e.g. `nextPage("invoices")`, `paginate(rows, 10, "invoices")`);
 * - `@expose`d navigation actions callable straight from the browser:
 *   {@link Paginated.gotoPage | gotoPage}, `resetPage`, `nextPage`,
 *   `previousPage`;
 * - a `paginate(items, perPage, pageName?)` helper that slices an in-memory array
 *   at the current page.
 *
 * All page writes clamp to `>= 1`. Optional lifecycle hooks fire around a page
 * change if you define them: `updatingPage`/`updatedPage` (default paginator) and
 * the generic `updatingPaginators`/`updatedPaginators`. Call `resetPage()` when a
 * filter or search term changes so the user isn't stranded on an empty page.
 *
 * @typeParam TBase - The (abstract) Component constructor being extended.
 * @param Base - The component class to mix into.
 * @returns A subclass of `Base` with pagination state and navigation.
 *
 * @example
 * ```tsx
 * class PostsPage extends Component.using(Pagination) {
 *   @locked posts: Post[] = [];
 *   async onMount() { this.posts = await Post.all(); }
 *   async render() {
 *     const posts = await Post.paginate(10); // uses this.page
 *     return (
 *       <div>
 *         {p.data.map((post) => <PostCard post={post} />)}
 *         <button onClick={this.previousPage} disabled={p.onFirstPage}>Prev</button>
 *         <button onClick={this.nextPage} disabled={!p.hasMorePages}>Next</button>
 *       </div>
 *     );
 *   }
 * }
 * ```
 */
export function Pagination<TBase extends AbstractComponentCtor>(Base: TBase) {
  abstract class Paginated extends Base {
    /** Current page of the default paginator, synced to the `?page=` query string. */
    @expose @url page = 1;

    /** Current page of each NAMED paginator (Livewire `pageName`), keyed by name. Snapshot-only. */
    @expose paginators: Record<string, number> = {};

    /**
     * Read the current page for a paginator (default or named).
     * @param pageName - Named paginator; omit for the default URL-synced one.
     * @returns The current 1-based page (>= 1).
     * @category Access
     */
    pageFor(pageName: string = DEFAULT_PAGE): number {
      if (pageName === DEFAULT_PAGE) return this.page;
      return this.paginators[pageName] ?? 1;
    }

    /**
     * Point database pagination at this component's page, for the rest of the request.
     *
     * With it, `Post.paginate(10)` inside the component returns the page the user is on —
     * no page argument to thread through. It runs on every request because a WebSocket
     * action carries no `?page=` for the query string to fall back on; the page lives here.
     */
    override async onBoot(ctx?: HttpContext): Promise<void> {
      await super.onBoot(ctx);
      setCurrentPageResolver((pageName) => this.pageFor(pageName));
    }

    /** Write a paginator's page (clamped to >= 1), firing the update hooks around it.
     *  Internal — not `@expose`, so it's never callable from the client. */
    _setPageValue(pageName: string, value: number): void {
      const next = Math.max(1, Math.floor(Number(value)) || 1);
      if (next === this.pageFor(pageName)) return;

      const hooks = this as unknown as PaginationHooks;
      hooks.updatingPaginators?.(next, pageName);
      if (pageName === DEFAULT_PAGE) hooks.updatingPage?.(next, pageName);

      if (pageName === DEFAULT_PAGE) this.page = next;
      else this.paginators = { ...this.paginators, [pageName]: next };

      if (pageName === DEFAULT_PAGE) hooks.updatedPage?.(next, pageName);
      hooks.updatedPaginators?.(next, pageName);
    }

    /**
     * Jump to a specific page (clamped to >= 1).
     * @param p - Target 1-based page.
     * @param pageName - Named paginator; omit for the default.
     * @category Navigation
     */
    @expose gotoPage(p: number, pageName: string = DEFAULT_PAGE): void {
      this._setPageValue(pageName, p);
    }
    /**
     * Reset to page 1 — call this when filters/search change so the user isn't
     * left on a now-empty page.
     * @category Navigation
     */
    @expose resetPage(pageName: string = DEFAULT_PAGE): void {
      this._setPageValue(pageName, 1);
    }
    /**
     * Advance to the next page.
     * @category Navigation
     */
    @expose nextPage(pageName: string = DEFAULT_PAGE): void {
      this._setPageValue(pageName, this.pageFor(pageName) + 1);
    }
    /**
     * Go back one page (clamped to >= 1).
     * @category Navigation
     */
    @expose previousPage(pageName: string = DEFAULT_PAGE): void {
      this._setPageValue(pageName, this.pageFor(pageName) - 1);
    }
  }
  return Paginated;
}
