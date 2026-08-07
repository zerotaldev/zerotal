// ── Path parameter extraction ─────────────────────────────────────────────────

/**
 * Extract the names of all `{param}` placeholders from a URL path string.
 *
 * @example
 * PathParams<'/api/users/{id}/posts/{postId}'>
 * // → 'id' | 'postId'
 */
export type PathParams<Path extends string> = Path extends `${string}{${infer Param}}${infer Tail}`
  ? Param | PathParams<Tail>
  : never;

/**
 * Build a record type from the path param names.
 * When there are no params, resolves to `undefined` so the argument is omittable.
 *
 * @example
 * ParamRecord<'/api/users/{id}'>  → { id: string | number }
 * ParamRecord<'/api/users'>       → undefined
 */
export type ParamRecord<Path extends string> = [PathParams<Path>] extends [never]
  ? undefined
  : { [K in PathParams<Path>]: string | number };

// ── Route map shape ───────────────────────────────────────────────────────────

/** HTTP verbs used as route-key prefixes. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Shape of a single route entry in the `ApiRouteMap`.
 *
 * All fields are optional — omit any that don't apply to a given route.
 */
export interface RouteShape {
  /** URL path parameters, e.g. `{ id: string | number }` */
  params?: Record<string, string | number>;
  /** Query-string parameters */
  query?: Record<string, string | number | boolean | undefined>;
  /** Request body for POST/PUT/PATCH */
  body?: Record<string, unknown>;
  /** The JSON response body type */
  response?: unknown;
}

/**
 * The route type map you write (or generate) for your API.
 *
 * Keys are `'METHOD /path'` strings — e.g. `'GET /api/users/{id}'`.
 *
 * @example
 * export interface Routes {
 *   'GET /api/users': {
 *     query:    { page?: number; perPage?: number };
 *     response: { data: UserResource[]; total: number };
 *   };
 *   'GET /api/users/{id}': {
 *     params:   { id: string | number };
 *     response: UserResource;
 *   };
 *   'POST /api/users': {
 *     body:     { name: string; email: string; password: string };
 *     response: UserResource;
 *   };
 *   'DELETE /api/users/{id}': {
 *     params:   { id: string | number };
 *     response: void;
 *   };
 * }
 */
export type ApiRouteMap = Partial<Record<`${HttpMethod} ${string}`, RouteShape>>;

// ── Accessor helpers ──────────────────────────────────────────────────────────

/** Extract all paths registered for a given HTTP method from a route map. */
export type PathsFor<Routes extends ApiRouteMap, Method extends HttpMethod> = {
  [K in keyof Routes & string]: K extends `${Method} ${infer Path}` ? Path : never;
}[keyof Routes & string];

/** Get the `response` type for a specific method + path combination. */
export type ResponseOf<
  Routes extends ApiRouteMap,
  Method extends HttpMethod,
  Path extends string,
> = `${Method} ${Path}` extends keyof Routes
  ? Routes[`${Method} ${Path}`] extends { response: infer R }
    ? R
    : unknown
  : unknown;

/** Get the `body` type for a specific method + path combination. */
export type BodyOf<
  Routes extends ApiRouteMap,
  Method extends HttpMethod,
  Path extends string,
> = `${Method} ${Path}` extends keyof Routes
  ? Routes[`${Method} ${Path}`] extends { body: infer B }
    ? B
    : Record<string, unknown>
  : Record<string, unknown>;

/** Get the `query` type for a specific method + path combination. */
export type QueryOf<
  Routes extends ApiRouteMap,
  Method extends HttpMethod,
  Path extends string,
> = `${Method} ${Path}` extends keyof Routes
  ? Routes[`${Method} ${Path}`] extends { query: infer Q }
    ? Q
    : Record<string, string | number | boolean | undefined>
  : Record<string, string | number | boolean | undefined>;
