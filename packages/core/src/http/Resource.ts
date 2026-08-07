/**
 * API Resource transformer — converts models to JSON response shapes.
 *
 * Extend this class, implement toArray(), and use it in controllers to
 * separate presentation from persistence. Wraps data in a `{ data: ... }`
 * envelope by default (toggle with `Resource.withoutWrapping()`).
 *
 * @example
 * export class UserResource extends Resource<User> {
 *   toArray(): Record<string, unknown> {
 *     return {
 *       id:    this.resource.id,
 *       name:  this.resource.name,
 *       email: this.resource.email,
 *     };
 *   }
 * }
 *
 * // In a controller:
 * ctx.json(new UserResource(user).toJson());              // { data: { id, name, email } }
 * ctx.json(UserResource.collection(UserResource, users)); // { data: [...] }
 * ctx.response = new UserResource(user).toResponse();     // 200 application/json
 */

/**
 * Minimal shape required to build a ResourceCollection.
 * Structurally compatible with PaginateResult<T> from @zerotal/orm so no
 * cross-package import is needed.
 */
export interface PaginatedData<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  lastPage: number;
  nextPageUrl(baseUrl?: string, query?: Record<string, string>): string | null;
  previousPageUrl(baseUrl?: string, query?: Record<string, string>): string | null;
}

// Process-level toggle for the `{ data: ... }` envelope. Intentionally
// module-global: wrapping is an app-wide presentation choice set once at boot,
// not per-request state.
let _wrap = true;

export abstract class Resource<T> {
  constructor(protected readonly resource: T) {}

  /** Override this to define the serialized representation. */
  abstract toArray(): Record<string, unknown>;

  /**
   * Return the resource as a plain object.
   * Includes the `{ data: ... }` wrapper unless `withoutWrapping()` was called.
   */
  toJson(): Record<string, unknown> {
    const payload = this.toArray();
    return _wrap ? { data: payload } : payload;
  }

  /**
   * Return a `Response` with the JSON-serialized resource and the given status.
   *
   * @example
   * ctx.response = new UserResource(user).toResponse(201);
   */
  toResponse(status = 200): Response {
    return Response.json(this.toJson(), { status });
  }

  // ── Static helpers ────────────────────────────────────────────────────────

  /**
   * Serialize a collection of models, wrapping the array in `{ data: [...] }`.
   *
   * @example
   * ctx.json(UserResource.collection(UserResource, users));
   */
  static collection<T, R extends Resource<T>>(
    ResourceClass: new (item: T) => R,
    items: T[],
    meta?: Record<string, unknown>,
  ): Record<string, unknown> | Record<string, unknown>[] {
    const data = items.map((item) => new ResourceClass(item).toArray());
    // Flat mode returns the bare array; a meta object always needs an envelope.
    if (!_wrap && !meta) return data;
    const result: Record<string, unknown> = { data };
    if (meta) Object.assign(result, { meta });
    return result;
  }

  /**
   * Disable the `{ data: ... }` wrapping for all resources in this request.
   * Call once at the application level if you prefer flat responses.
   */
  static withoutWrapping(): void {
    _wrap = false;
  }

  /** Re-enable the `{ data: ... }` wrapper (the default). */
  static withWrapping(): void {
    _wrap = true;
  }

  /** Returns whether wrapping is currently enabled. */
  static wrapping(): boolean {
    return _wrap;
  }
}

/**
 * Paginated API resource collection — wraps a PaginateResult into the standard
 * `{ data, meta, links }` envelope.
 *
 * @example
 * // In a controller:
 * const posts = await Post.query().paginate(15, page);
 * ctx.json(ResourceCollection.of(PostResource, posts));
 * // → {
 * //     data: [...],
 * //     meta: { current_page, last_page, total, per_page, from, to },
 * //     links: { first, prev, next, last }
 * //   }
 *
 * @example
 * // With a base URL for fully-qualified pagination links:
 * ctx.json(ResourceCollection.of(PostResource, posts, '/api/posts'));
 */
export class ResourceCollection {
  /**
   * Transform a paginated result set using the given Resource class.
   *
   * @param ResourceClass - The Resource subclass to transform each item.
   * @param paginated     - A PaginateResult (or any object matching PaginatedData<T>).
   * @param baseUrl       - Optional base URL; used to build `links.*` href strings.
   * @param query         - Extra query params merged into every pagination link.
   */
  static of<T, R extends Resource<T>>(
    ResourceClass: new (item: T) => R,
    paginated: PaginatedData<T>,
    baseUrl = "",
    query: Record<string, string> = {},
  ): Record<string, unknown> {
    const data = paginated.data.map((item) => new ResourceClass(item).toArray());

    const from = paginated.data.length > 0 ? (paginated.page - 1) * paginated.perPage + 1 : null;
    const to =
      paginated.data.length > 0
        ? (paginated.page - 1) * paginated.perPage + paginated.data.length
        : null;

    const meta = {
      current_page: paginated.page,
      last_page: paginated.lastPage,
      total: paginated.total,
      per_page: paginated.perPage,
      from,
      to,
    };

    const links = {
      first: baseUrl ? `${baseUrl}?${new URLSearchParams({ ...query, page: "1" })}` : null,
      prev: paginated.previousPageUrl(baseUrl, query),
      next: paginated.nextPageUrl(baseUrl, query),
      last: baseUrl
        ? `${baseUrl}?${new URLSearchParams({ ...query, page: String(paginated.lastPage) })}`
        : null,
    };

    return { data, meta, links };
  }
}
