/**
 * File-based routing: scans a routes directory and registers a route per file,
 * deriving URL paths, names, layouts, and stacked `_middleware.ts` from the file
 * tree, with an extension point for framework packages to claim route files.
 *
 * Why not Bun's native `Bun.FileSystemRouter`? That router models Next-style
 * pages only — it has no concept of route groups `(auth)`/`(guest)`, shared
 * `_layout`/`_middleware` stacks, named middleware groups, or feeding the
 * framework's middleware pipeline. This resolver produces ordinary
 * `Router.*` registrations, which still compile down to Bun's native `routes`
 * map, so we keep the native fast path while supporting those extra features.
 */
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Router } from "./Router.ts";
import type { HttpMethod, MiddlewareClass, FileHandler, ViewComponent } from "./Route.ts";

// ── Public types ──────────────────────────────────────────────────────────────

export type { FileHandler };

/**
 * Per-method middleware map for a route file's `export const middleware`.
 * `ALL` applies to every method the file handles; the per-verb arrays add to it.
 *
 * @internal
 */
export interface RouteMethodMiddleware {
  ALL?: MiddlewareClass[];
  GET?: MiddlewareClass[];
  POST?: MiddlewareClass[];
  PUT?: MiddlewareClass[];
  PATCH?: MiddlewareClass[];
  DELETE?: MiddlewareClass[];
}

/**
 * A route file's `export const middleware` — either an array applied to all methods,
 * or a {@link RouteMethodMiddleware} map for per-method control.
 *
 * @example
 * export const middleware = [AuthMiddleware];                 // all methods
 * export const middleware = { ALL: [AuthMiddleware], POST: [ThrottleMiddleware] };
 */
export type RouteMiddleware = MiddlewareClass[] | RouteMethodMiddleware;

/** Shape of a route module. `default` may be a FileHandler or a ViewComponent;
 *  `layout` overrides the directory `_layout` (null = no layout). */
/** @internal */
export interface RouteModule {
  default?: FileHandler | ViewComponent;
  GET?: FileHandler;
  POST?: FileHandler;
  PUT?: FileHandler;
  PATCH?: FileHandler;
  DELETE?: FileHandler;
  layout?: ViewComponent | null;
  /** Per-file middleware (in addition to any stacked `_middleware.ts`). */
  middleware?: RouteMiddleware;
}

/**
 * Optional `export const meta = { GET: { name: 'users.show' } }` in route files.
 *
 * @internal
 */
export interface RouteFileMeta {
  GET?: { name?: string };
  POST?: { name?: string };
  PUT?: { name?: string };
  PATCH?: { name?: string };
  DELETE?: { name?: string };
}

/**
 * Shape of a `_middleware.ts` file.
 *
 * @internal
 */
export interface MiddlewareModule {
  middleware: MiddlewareClass[];
}

// ── File-route resolvers (framework extension point) ─────────────────────────

/**
 * Context handed to a file-route resolver for each scanned route file.
 *
 * @internal
 */
export interface FileRouteContext {
  /** URL path derived from the file location (e.g. '/users/:id'). */
  urlPath: string;
  /** The imported module's exports. */
  module: Record<string, unknown>;
  /** Middleware collected from _middleware.ts files (outermost first). */
  middleware: MiddlewareClass[];
  /** Auto-generated GET route name for this path. */
  name: string;
  /** True when the file is an index.ts/index.tsx. */
  isIndex: boolean;
  /** Absolute path to the source file on disk (useful for build-time compilation). */
  filePath: string;
  /** Nearest _layout component for this dir, when layouts are enabled. */
  layout?: ViewComponent | undefined;
}

/**
 * A resolver lets framework packages claim a route file's exports before the
 * default verb-function handling runs. Return `true` to claim the file.
 *
 * @example
 * // @zerotal/flow registers Component classes found in file routes:
 * registerFileRouteResolver(({ urlPath, module, middleware }) => {
 *   const PageClass = findFlowPageExport(module);
 *   if (!PageClass) return false;
 *   Router.flow(urlPath, PageClass, middleware);
 *   return true;
 * });
 *
 * @internal
 */
export type FileRouteResolver = (ctx: FileRouteContext) => boolean;

const _fileRouteResolvers: FileRouteResolver[] = [];

/** Register a resolver. Call from a provider's onRegister() so it is in place
 *  before Application.boot() scans file routes. */
/** @internal */
export function registerFileRouteResolver(resolver: FileRouteResolver): void {
  _fileRouteResolvers.push(resolver);
}

/** @internal Clear all registered file-route resolvers. Used in tests. */
export function _resetFileRouteResolvers(): void {
  _fileRouteResolvers.length = 0;
}

let _layoutsEnabled = false;

/** Opt into nearest-`_layout` discovery for file-based routes. */
export function enableFileRouteLayouts(): void {
  _layoutsEnabled = true;
}

/** @internal Disable file-route layout discovery. Used in tests. */
export function _resetFileRouteLayouts(): void {
  _layoutsEnabled = false;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FILE_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

// ── Path conversion ───────────────────────────────────────────────────────────

/**
 * Convert a file path (relative to the routes base dir) to a URL path.
 *
 * Rules applied in order:
 *  1. Normalise Windows backslashes
 *  2. Strip `.ts` / `.tsx` extension
 *  3. Strip `(group)` directory segments — they organise files without adding URL segments
 *  4. `[...name]` → `*`    (catch-all — Phase 1 basic support)
 *  5. `[param]`   → `:param` (dynamic segment)
 *  6. `index`     → ``     (directory URL, index file)
 *  7. Reassemble with `/`, ensure leading slash
 *
 * @example
 * filePathToRoutePath('index.ts')                    // '/'
 * filePathToRoutePath('about.ts')                    // '/about'
 * filePathToRoutePath('users/index.ts')              // '/users'
 * filePathToRoutePath('users/[id].ts')               // '/users/:id'
 * filePathToRoutePath('(admin)/users/index.ts')      // '/users'
 * filePathToRoutePath('api/users/[id]/posts.ts')     // '/api/users/:id/posts'
 */
export function filePathToRoutePath(filePath: string): string {
  const normalised = filePath.replace(/\\/g, "/").replace(/\.(tsx?)$/, "");

  const segments = normalised.split("/").flatMap((segment): string[] => {
    // Route groups: (admin) → stripped (contributes no URL segment)
    if (/^\(.*\)$/.test(segment)) return [];

    // Catch-all: [...slug] → *
    if (/^\[\.\.\.([^\]]+)\]$/.test(segment)) return ["*"];

    // Dynamic: [id] → :id
    const dynamicMatch = segment.match(/^\[([^\]]+)\]$/);
    if (dynamicMatch) return [`:${dynamicMatch[1]}`];

    // index → '' (directory URL)
    if (segment === "index") return [""];

    return [segment];
  });

  const url = "/" + segments.filter(Boolean).join("/");
  return url === "/" ? "/" : url.replace(/\/$/, "") || "/";
}

// ── Route name generation ─────────────────────────────────────────────────────

/**
 * Auto-generate a route name from a URL path and HTTP method.
 *
 * Follows a conventional RESTful naming scheme:
 *
 * | URL               | Method | Name              |
 * |-------------------|--------|-------------------|
 * | `/`               | GET    | `home`            |
 * | `/about`          | GET    | `about`           |
 * | `/about`          | POST   | `about.store`     |
 * | `/api/users`      | GET    | `api.users.index` |
 * | `/api/users`      | POST   | `api.users.store` |
 * | `/api/users/:id`  | GET    | `api.users.show`  |
 * | `/api/users/:id`  | PUT    | `api.users.update`|
 * | `/api/users/:id`  | DELETE | `api.users.destroy`|
 *
 * @param isIndex  Pass `true` when the route came from an `index.ts` file —
 *                 this adds the `.index` suffix to multi-segment GET routes.
 *                 Leaf files (`about.ts`) never get `.index`.
 */
export function generateRouteName(urlPath: string, method: HttpMethod, isIndex = false): string {
  if (urlPath === "/") return "home";

  const hasParam = urlPath.includes(":") || urlPath.includes("*");

  // Strip leading /, replace slashes with dots, strip :param and * segments
  const base = urlPath
    .replace(/^\//, "")
    .replace(/\//g, ".")
    .replace(/:[^./]+/g, "")
    .replace(/\*/g, "")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  if (!hasParam) {
    if (method === "GET") {
      // index.ts collection endpoint (e.g. api/users/index.ts → /api/users) → api.users.index
      // leaf page (e.g. about.ts → /about or named/about.ts → /named/about) → about / named.about
      return isIndex && base.includes(".") ? `${base}.index` : base || "home";
    }
    if (method === "POST") return `${base}.store`;
    return `${base}.${method.toLowerCase()}`;
  }

  switch (method) {
    case "GET":
      return `${base}.show`;
    case "POST":
      return `${base}.store`;
    case "PUT":
    case "PATCH":
      return `${base}.update`;
    case "DELETE":
      return `${base}.destroy`;
  }
}

// ── Middleware stacking ───────────────────────────────────────────────────────

/**
 * For a relative file path inside the routes directory, collect all
 * `_middleware.ts` modules from the base to the file's directory (inclusive),
 * outermost-first.
 *
 * @example
 * // For 'dashboard/settings/profile.ts' checks:
 * //   _middleware.ts
 * //   dashboard/_middleware.ts
 * //   dashboard/settings/_middleware.ts
 */
/**
 * The `_middleware` file for a directory, or `undefined` when there is none.
 *
 * @param baseDir - Routes root.
 * @param dir - Directory relative to the root (`""` for the root itself).
 * @returns Absolute path to `_middleware.ts` or `_middleware.tsx`.
 */
async function _findMiddlewareFile(baseDir: string, dir: string): Promise<string | undefined> {
  for (const ext of ["ts", "tsx"] as const) {
    const path = dir
      ? join(baseDir, dir, `_middleware.${ext}`)
      : join(baseDir, `_middleware.${ext}`);
    if (await Bun.file(path).exists()) return path;
  }
  return undefined;
}

async function _collectMiddleware(
  baseDir: string,
  relativeFile: string,
  reloadId?: string,
): Promise<MiddlewareClass[]> {
  const normalised = relativeFile.replace(/\\/g, "/");
  const parts = normalised.split("/");
  parts.pop(); // remove file name

  // Build list of directory paths to check, root-first
  const directories: string[] = [""];
  let accumulated = "";
  for (const segment of parts) {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment;
    directories.push(accumulated);
  }

  const result: MiddlewareClass[] = [];
  for (const dir of directories) {
    // Both extensions. The scanner skips `_middleware.tsx` as a route, so probing only
    // `.ts` here meant a JSX-authored middleware file was silently never applied — its
    // sibling routes stayed live and unguarded, with no error and no log. A convention
    // that fails open is worse than one that does not exist.
    const middlewarePath = await _findMiddlewareFile(baseDir, dir);
    try {
      if (middlewarePath) {
        // Convert to a file:// URL so dynamic import works on Windows (raw
        // absolute paths with backslashes are not valid import specifiers).
        // Append ?t=<reloadId> to bust the module cache on hot-reload.
        const href = pathToFileURL(middlewarePath).href;
        const importUrl = reloadId ? `${href}?t=${reloadId}` : href;
        const loadedModule = (await import(importUrl)) as MiddlewareModule;
        if (Array.isArray(loadedModule.middleware)) {
          result.push(...loadedModule.middleware);
        }
      }
    } catch {
      // The file is missing or failed to import — skip it.
    }
  }
  return result;
}

/**
 * Combine the stacked `_middleware.ts` chain (`base`) with a route file's own
 * `export const middleware` for a specific verb. Array form applies to every method;
 * object form applies `ALL` plus the per-verb list. File middleware runs after (inside)
 * the directory middleware.
 */
function _fileRouteMiddleware(
  module: RouteModule,
  base: MiddlewareClass[],
  verb: HttpMethod,
): MiddlewareClass[] {
  const m = module.middleware;
  if (!m) return base;
  if (Array.isArray(m)) return [...base, ...m];
  if (typeof m === "object") return [...base, ...(m.ALL ?? []), ...(m[verb] ?? [])];
  return base;
}

// ── Layout discovery ──

const _LAYOUT_EXTS = [".tsx", ".ts", ".jsx", ".js"] as const;

async function _collectLayout(
  baseDir: string,
  relativeFile: string,
  reloadId?: string,
): Promise<ViewComponent | undefined> {
  const parts = relativeFile.replace(/\\/g, "/").split("/");
  parts.pop();
  for (let depth = parts.length; depth >= 0; depth--) {
    const dir = parts.slice(0, depth).join("/");
    for (const extension of _LAYOUT_EXTS) {
      const layoutPath = dir
        ? join(baseDir, dir, `_layout${extension}`)
        : join(baseDir, `_layout${extension}`);
      try {
        if (await Bun.file(layoutPath).exists()) {
          const href = pathToFileURL(layoutPath).href;
          const importUrl = reloadId ? `${href}?t=${reloadId}` : href;
          const loadedModule = (await import(importUrl)) as { default?: unknown };
          if (typeof loadedModule.default === "function") {
            return loadedModule.default as ViewComponent;
          }
        }
      } catch {
        // A page module that fails to import is skipped — component resolution is best-effort.
      }
    }
  }
  return undefined;
}

// ── Main scanner ──────────────────────────────────────────────────────────────

/**
 * Scan `baseDir` for route files and register them with the global Router.
 *
 * Called from `Application.fileBasedRouting()` during the boot phase.
 * Returns the number of individual method handlers registered.
 *
 * **Skipped files:**
 * - `_middleware.ts` files (middleware config, not routes)
 * - `*.test.ts` / `*.spec.ts` files
 * - Any file with a leading underscore (`_*.ts`)
 * - `.d.ts` declaration files
 *
 * **Registration order:** file-based routes are registered during boot, before
 * `routes/index.ts` runs. Explicit routes registered afterward take precedence
 * (last write wins in `Router.state.routes`).
 *
 * @param reloadId  When provided (during a hot-reload), route and middleware
 *                  files are imported with `?t=<reloadId>` appended so Bun
 *                  creates a fresh module namespace instead of returning the
 *                  cached version.  Omit on first boot.
 * @returns The number of individual method handlers registered.
 *
 * @internal
 */
export async function scanFileRoutes(baseDir: string, reloadId?: string): Promise<number> {
  const absoluteBase = _resolveAbsoluteBase(baseDir);

  if (!existsSync(absoluteBase)) {
    return 0;
  }

  const glob = new Bun.Glob("**/*.{ts,tsx}");
  let count = 0;

  for await (const relativeFile of glob.scan({ cwd: absoluteBase })) {
    const normalised = relativeFile.replace(/\\/g, "/");

    if (_shouldSkip(normalised)) continue;

    // Apply any active group prefix (set by Router.groupAsync wrapping scanFileRoutes).
    const groupPrefix = Router._activePrefix;
    const groupMiddleware = Router._activeMiddleware;

    const rawPath = filePathToRoutePath(normalised);
    const urlPath = groupPrefix + rawPath;
    // Use join() so path separators are correct on every platform.
    const absoluteFile = join(absoluteBase, normalised);
    // `index.ts` files are collection endpoints (GET → .index suffix in auto-names).
    const isIndex = /(?:^|\/)index\.(tsx?)$/.test(normalised);
    const fileMiddleware = await _collectMiddleware(absoluteBase, normalised, reloadId);
    // Stacked directory middleware: group prefix, then `_middleware.ts` chain. A route
    // file's own `export const middleware` is layered on per-verb after the import below.
    const baseMiddleware = [...groupMiddleware, ...fileMiddleware];

    const layout = _layoutsEnabled
      ? await _collectLayout(absoluteBase, normalised, reloadId)
      : undefined;

    const fileHref = pathToFileURL(absoluteFile).href;
    const importUrl = reloadId ? `${fileHref}?t=${reloadId}` : fileHref;
    let loadedModule: RouteModule & { meta?: RouteFileMeta };
    try {
      loadedModule = (await import(importUrl)) as RouteModule & { meta?: RouteFileMeta };
    } catch (error) {
      console.error(`[FileRouter] Failed to import ${normalised}:`, error);
      continue;
    }

    const meta: RouteFileMeta = (loadedModule.meta ?? {}) as RouteFileMeta;

    // Framework resolvers get first claim (e.g. @zerotal/flow Component exports).
    let claimed = false;
    for (const resolver of _fileRouteResolvers) {
      try {
        if (
          resolver({
            urlPath,
            module: loadedModule as Record<string, unknown>,
            middleware: _fileRouteMiddleware(loadedModule, baseMiddleware, "GET"),
            name: generateRouteName(urlPath, "GET", isIndex),
            isIndex,
            filePath: absoluteFile,
            layout,
          })
        ) {
          claimed = true;
          count++;
          break;
        }
      } catch (error) {
        console.error(`[FileRouter] Resolver failed for ${normalised}:`, error);
      }
    }
    // A claimed file (e.g. a Flow Component owning GET) can still export other
    // verb handlers — POST/PUT/PATCH/DELETE functions register normally, so a
    // login page and its form handler can live in the same file.

    // `export default` is a GET alias when no explicit GET export exists.
    if (
      !claimed &&
      typeof loadedModule.default === "function" &&
      typeof loadedModule.GET !== "function"
    ) {
      const name = meta.GET?.name ?? generateRouteName(urlPath, "GET", isIndex);
      Router._registerFileHandler(
        "GET",
        urlPath,
        loadedModule.default as FileHandler,
        _fileRouteMiddleware(loadedModule, baseMiddleware, "GET"),
        name,
      );
      count++;
    }

    for (const verb of FILE_METHODS) {
      if (claimed && verb === "GET") continue; // GET belongs to the claimed page
      const handler = loadedModule[verb];
      if (typeof handler !== "function") continue;
      const name = meta[verb]?.name ?? generateRouteName(urlPath, verb, isIndex);
      Router._registerFileHandler(
        verb,
        urlPath,
        handler,
        _fileRouteMiddleware(loadedModule, baseMiddleware, verb),
        name,
      );
      count++;
    }
  }

  return count;
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _resolveAbsoluteBase(dir: string): string {
  return resolve(dir);
}

/**
 * Whether a scanned file is convention plumbing rather than a route.
 *
 * `_`-prefixed names are reserved by the convention, so the leading-underscore rule covers
 * `_middleware.*` and anything else an app parks in the routes tree. Tests and declaration
 * files are excluded because they are colocated with routes and are not endpoints.
 */
function _shouldSkip(relativePath: string): boolean {
  const file = relativePath.split("/").at(-1) ?? "";
  return (
    file.startsWith("_") ||
    file.endsWith(".test.ts") ||
    file.endsWith(".test.tsx") ||
    file.endsWith(".spec.ts") ||
    file.endsWith(".spec.tsx") ||
    file.endsWith(".d.ts")
  );
}
