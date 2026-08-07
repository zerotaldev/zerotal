import { pageElements } from "@zerotal/core";

/** Operators accepted by {@link QueryBuilder.where} and its variants. */
export type WhereOperator =
  "=" | "!=" | ">" | ">=" | "<" | "<=" | "like" | "not like" | "in" | "not in";
/** Sort direction for `ORDER BY`. */
export type OrderDirection = "asc" | "desc";

/** @internal One accumulated WHERE predicate in the builder's query state. */
export interface WhereClause {
  column: string;
  /** Broad string so the builder can store the standard operators plus
   *  internal markers ('is null', '__raw__', 'between', 'column', 'exists', …). */
  operator: string;
  value: unknown;
  boolean: "and" | "or";
  /** Second column name — used by whereColumn(). */
  column2?: string;
  /**
   * Nested predicates, present only when `operator === "__group__"`. Rendered inside
   * parentheses, which is what keeps an `OR` chain from escaping the surrounding `AND`s.
   */
  group?: WhereClause[];
}

/** @internal One accumulated ORDER BY term in the builder's query state. */
export interface OrderClause {
  column: string;
  /** `"__raw__"` marks a raw `orderByRaw()` expression (column holds the raw SQL). */
  direction: OrderDirection | "__raw__";
}

/** @internal One accumulated HAVING predicate in the builder's query state. */
export interface HavingClause {
  column: string;
  operator: string;
  value: unknown;
}

/** The kinds of join the builder can emit. */
export type JoinType = "inner" | "left" | "right" | "cross";

/** @internal One accumulated JOIN clause in the builder's query state. */
export interface JoinClause {
  type: JoinType;
  /** Table expression — a bare table name or `(subquery) AS alias`. */
  table: string;
  first?: string;
  operator?: string;
  second?: string;
  /** Bindings introduced by a subquery join (joinSub). */
  bindings?: unknown[];
}

/** @internal One accumulated UNION arm (a compiled subquery + bindings). */
export interface UnionClause {
  sql: string;
  bindings: unknown[];
  all: boolean;
}

/** @internal The full mutable state a {@link QueryBuilder} compiles into SQL. */
export interface QueryState {
  table: string;
  selects: string[];
  distinct: boolean;
  joins: JoinClause[];
  wheres: WhereClause[];
  orders: OrderClause[];
  groupBys: string[];
  havings: HavingClause[];
  unions: UnionClause[];
  limit: number | undefined;
  offset: number | undefined;
  /** Pessimistic-lock suffix, e.g. 'FOR UPDATE' / 'FOR SHARE'. */
  lock: string | undefined;
}

/** Standard pagination metadata block. */
export interface PaginateMeta {
  /** Index (1-based) of the first item on the current page, or null when empty. */
  from: number | null;
  /** Index (1-based) of the last item on the current page, or null when empty. */
  to: number | null;
  /** Current page number. */
  currentPage: number;
  /** Last (highest) page number. */
  lastPage: number;
  /** Items per page. */
  perPage: number;
  /** Total number of matching rows. */
  total: number;
  /** Base URL used for link generation. */
  path: string;
}

/**
 * Result of {@link QueryBuilder.paginate} — a full offset paginator with total
 * row count, page metadata and URL helpers.
 */
export interface PaginateResult<T = Record<string, unknown>> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  lastPage: number;
  /** Index (1-based) of the first item on this page, or null when the page is empty. */
  from: number | null;
  /** Index (1-based) of the last item on this page, or null when the page is empty. */
  to: number | null;
  /** Standard metadata block (from/to/path/total/…) for driving UI components. */
  meta: PaginateMeta;
  /**
   * URL for the next page, or null on the last page.
   * Extra query params (e.g. filters) are merged and preserved.
   * @example result.nextPageUrl('/posts', { search: 'bun' })
   */
  nextPageUrl(baseUrl?: string, query?: Record<string, string>): string | null;
  /**
   * URL for the previous page, or null on the first page.
   * Extra query params are merged and preserved.
   */
  previousPageUrl(baseUrl?: string, query?: Record<string, string>): string | null;
  /**
   * Build the URL for any page number (relative to `baseUrl`, default the
   * paginator's configured `path`).
   * @example result.url(3) // '/posts?page=3'
   */
  url(page: number, baseUrl?: string, query?: Record<string, string>): string;
  /** True when there is at least one more page after the current one. */
  hasMorePages: boolean;
  /** True when the current page is the first page. */
  onFirstPage: boolean;
  /** True when the current page is the last page. */
  onLastPage: boolean;
  /**
   * Page-number window for a numbered pager, with `"..."` gaps —
   * e.g. `[1, "...", 4, 5, 6, "...", 20]`.
   * @param each - Page links on each side of the current page (default `1`).
   */
  elements(each?: number): (number | "...")[];
  /**
   * Array of page links — useful for rendering pagination UI.
   * Extra query params are merged onto every link URL.
   * @example result.links('/posts', { search: 'bun' })
   */
  links(
    baseUrl?: string,
    query?: Record<string, string>,
  ): Array<{ page: number; url: string; active: boolean }>;
}

/** Build a query-string from a page number plus optional extra params. */
function _pageUrl(baseUrl: string, page: number, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ ...extra, page: String(page) });
  return `${baseUrl}?${params.toString()}`;
}

/** Options accepted by the pagination helper factories. */
export interface PaginationHelperOptions {
  /** Base path used by no-argument URL helpers and `meta.path`. Default: `''`. */
  path?: string;
}

/** Attach URL helper methods + metadata to a plain paginate result object. */
export function withPaginationHelpers<T>(
  raw: {
    data: T[];
    total: number;
    page: number;
    perPage: number;
    lastPage: number;
  },
  options: PaginationHelperOptions = {},
): PaginateResult<T> {
  const r = raw as PaginateResult<T>;
  const path = options.path ?? "";

  const from = raw.total === 0 ? null : (raw.page - 1) * raw.perPage + 1;
  const to = raw.total === 0 || raw.data.length === 0 ? null : (from ?? 0) + raw.data.length - 1;

  r.from = from;
  r.to = to;
  r.meta = {
    from,
    to,
    currentPage: raw.page,
    lastPage: raw.lastPage,
    perPage: raw.perPage,
    total: raw.total,
    path,
  };

  r.url = (page, baseUrl = path, query = {}) => _pageUrl(baseUrl, page, query);
  r.nextPageUrl = (baseUrl = path, query = {}) =>
    raw.page < raw.lastPage ? _pageUrl(baseUrl, raw.page + 1, query) : null;
  r.previousPageUrl = (baseUrl = path, query = {}) =>
    raw.page > 1 ? _pageUrl(baseUrl, raw.page - 1, query) : null;
  r.hasMorePages = raw.page < raw.lastPage;
  r.onFirstPage = raw.page <= 1;
  r.onLastPage = raw.page >= raw.lastPage;
  r.elements = (each = 1) => pageElements(raw.page, raw.lastPage, each);
  r.links = (baseUrl = path, query = {}) =>
    Array.from({ length: raw.lastPage }, (_, i) => ({
      page: i + 1,
      url: _pageUrl(baseUrl, i + 1, query),
      active: i + 1 === raw.page,
    }));
  return r;
}

/**
 * Result of {@link QueryBuilder.simplePaginate} — "next/prev only" pagination
 * that skips the expensive `COUNT(*)` query. There is no `total` or `lastPage`.
 */
export interface SimplePaginateResult<T = Record<string, unknown>> {
  data: T[];
  perPage: number;
  page: number;
  /** Index (1-based) of the first item on this page, or null when empty. */
  from: number | null;
  /** Index (1-based) of the last item on this page, or null when empty. */
  to: number | null;
  /** True when another page follows (a `perPage + 1` probe row was found). */
  hasMorePages: boolean;
  /** True when the current page is the first page. */
  onFirstPage: boolean;
  nextPageUrl(baseUrl?: string, query?: Record<string, string>): string | null;
  previousPageUrl(baseUrl?: string, query?: Record<string, string>): string | null;
  url(page: number, baseUrl?: string, query?: Record<string, string>): string;
}

/** Attach URL helpers + metadata to a simple-paginate result object. */
export function withSimplePaginationHelpers<T>(
  raw: {
    data: T[];
    perPage: number;
    page: number;
    hasMore: boolean;
  },
  options: PaginationHelperOptions = {},
): SimplePaginateResult<T> {
  const { hasMore, ...rest } = raw;
  const r = rest as unknown as SimplePaginateResult<T>;
  const path = options.path ?? "";

  const from = raw.data.length === 0 ? null : (raw.page - 1) * raw.perPage + 1;
  const to = raw.data.length === 0 ? null : (from ?? 0) + raw.data.length - 1;
  r.from = from;
  r.to = to;

  r.url = (page, baseUrl = path, query = {}) => _pageUrl(baseUrl, page, query);
  r.hasMorePages = hasMore;
  r.onFirstPage = raw.page <= 1;
  r.nextPageUrl = (baseUrl = path, query = {}) =>
    hasMore ? _pageUrl(baseUrl, raw.page + 1, query) : null;
  r.previousPageUrl = (baseUrl = path, query = {}) =>
    raw.page > 1 ? _pageUrl(baseUrl, raw.page - 1, query) : null;
  return r;
}

/** Result of {@link QueryBuilder.cursorPaginate} — id-based cursor pagination. */
export interface CursorPaginateResult<T = Record<string, unknown>> {
  data: T[];
  /** Cursor pointing past the last item, or null on the final page. */
  nextCursor: number | null;
  /** Cursor for the page that preceded this one, or null on the first page. */
  prevCursor: number | null;
  /** True when another page follows (equivalent to `nextCursor !== null`). */
  hasMore: boolean;
}

/** Options for {@link QueryBuilder.keysetPaginate}. */
export interface KeysetOptions {
  /**
   * Opaque cursor string from the previous page's `nextCursor`.
   * `null` or omitted = first page.
   */
  cursor?: string | null;
  /** Column used for keyset ordering. Must be a safe SQL identifier. Default: `'id'`. */
  column?: string;
  /** Sort direction. Default: `'asc'`. */
  direction?: "asc" | "desc";
  /** Items per page. Default: `15`. */
  limit?: number;
}

/** Result of {@link QueryBuilder.keysetPaginate} — opaque-cursor keyset pagination. */
export interface KeysetPaginateResult<T = Record<string, unknown>> {
  data: T[];
  /**
   * Opaque base64 cursor pointing past the last item, or `null` on the final page.
   * Pass this directly to the next `keysetPaginate({ cursor })` call.
   */
  nextCursor: string | null;
}
