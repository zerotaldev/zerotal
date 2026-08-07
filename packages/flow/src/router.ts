import {
  Router,
  type HttpContext,
  type RouteRegistration,
  type MiddlewareClass,
} from "@zerotal/core";
import type { Component } from "./Component.ts";
import type { PageClassWithMeta } from "./registry.ts";
import { registerPage } from "./registry.ts";
import { dehydrate, warnIfLarge } from "./dehydrate.ts";
import { _renderFlowPage } from "./jsx-runtime.ts";
import { populatePresence } from "./presence.ts";
import { populateShared } from "./shared.ts";
import { restoreDurable, persistDurable } from "./durable.ts";
import type { HtmlNode } from "./jsx-runtime.ts";
import { _runtimeJs } from "./provider/FlowProvider.ts";
import { randomComponentId, toScriptJson } from "./utils.ts";
import type { Layout } from "./Layout.ts";
import {
  getUrlProps,
  getSessionProps,
  sessionKeyFor,
  getRouteParamProps,
  type ParamModel,
  getLockedProps,
  getExposedProps,
} from "./decorators.ts";

/**
 * Register a Flow Component as a GET route.
 *
 * Middleware attached here (or via an enclosing Router.group()) runs on the
 * initial page load AND is re-applied on every WebSocket update for this page
 * (Livewire-style persistent middleware).
 *
 * @example
 * import { Router } from '@zerotal/core';
 * Router.flow('/dashboard', Dashboard);
 * Router.flow('/admin', AdminPage, [RequireAuthMiddleware]);
 */
export function flowRoute(
  path: string,
  PageClass: PageClassWithMeta,
  middleware: MiddlewareClass[] = [],
): RouteRegistration {
  // Resolve the full runtime path (group prefixes included) so the snapshot
  // memo path matches the registered route — required for middleware lookup
  // on WebSocket updates.
  const fullPath = Router.groupPrefix + path;
  registerPage(fullPath, PageClass as unknown as typeof Component);

  const handler = _makeFlowHandler(fullPath, PageClass);
  return Router.get(path, handler, "handle", middleware);
}

/**
 * Register a Flow page discovered by the file-route scanner.
 *
 * Unlike {@link flowRoute} (the `Router.flow` macro, which prepends the active group
 * prefix), `fullPath` here is the COMPLETE URL already produced by `scanFileRoutes`
 * (group prefix + file path). It is therefore registered at the absolute path — mirroring
 * core's `_registerFileHandler` for `.ts` file routes — so a `/:tenancy` group prefix is
 * applied once, not twice.
 */
export function registerFlowFileRoute(
  fullPath: string,
  PageClass: PageClassWithMeta,
  middleware: MiddlewareClass[] = [],
  name?: string,
): void {
  registerPage(fullPath, PageClass as unknown as typeof Component);
  const handler = _makeFlowHandler(fullPath, PageClass);
  Router._registerAbsolute("GET", fullPath, handler as never, "handle", middleware, name);
}

// ── HTTP GET handler factory ──────────────────────────────────────────────────

type PageClassWithLayout = PageClassWithMeta & { layout?: new () => Layout };

/**
 * Stable DOM-marker id for a JSX-native `layout(page)` wrapper. Derived from the
 * override's source so two pages that wrap with the same layout produce the same
 * id (their shells match on flow:navigate); different wrappers differ (full nav).
 * Not security-sensitive — just a client-side same-layout comparison key.
 */
export function _layoutId(page: Component): string {
  const src = page.layout.toString();
  let hash = 5381;
  for (let i = 0; i < src.length; i++) hash = (hash * 33) ^ src.charCodeAt(i);
  return "l" + (hash >>> 0).toString(36);
}

function _makeFlowHandler(path: string, PageClass: PageClassWithMeta) {
  return class FlowPageHandler {
    async handle(ctx: HttpContext): Promise<void> {
      const http = ctx;
      // Wrap the initial render: an onMount()/render() throw surfaces as the dev error overlay
      // (like an action throw) rather than a bare 500. Production rethrows → a normal 500 with no
      // stack leak.
      try {
        const page = new PageClass() as Component;
        const compId = randomComponentId(PageClass.name);
        const compName = PageClass.name;

        // Identity used by nested children (deterministic child ids) and by
        // persistent middleware (children inherit the parent's route path).
        page._flowId = compId;
        page._flowPath = path;

        // Seed @url properties from the request's query string before onMount().
        // This makes the page state reflect the URL on initial render.
        _seedUrlProps(page, http.request);

        // Seed @session properties from the session (if SessionMiddleware is active).
        _seedSessionProps(page, compName, http);

        // Seed @param properties from the matched route segments — including resolved
        // model bindings. Initial GET only; round-trips restore these from the snapshot.
        _seedRouteParams(page, ctx);

        // boot() runs on every request (here: the initial render), before mount().
        // Forward the request HttpContext so dynamic-segment pages can read route
        // params and implicitly-bound models off `ctx.params` (e.g. `:account` ->
        // Account at `ctx.params.account`) inside onBoot()/onMount().
        await page.onBoot(ctx);

        // Durable/resumable snapshots: if this component opted into `static durable` and a valid
        // stored snapshot exists for this user/session + route, resume from it — restore state and
        // run onHydrate (like a WS round-trip), skipping onMount. Otherwise mount fresh. A missing,
        // tampered, or stale-key entry falls through to a normal mount. No-op unless opted in.
        if (await restoreDurable(page, ctx)) {
          await page.onHydrate();
        } else {
          await page.onMount(ctx);
        }

        // Persist @session props back to session after onMount (captures any changes).
        _persistSessionProps(page, compName, http);

        // A redirect() issued from onBoot()/onMount() short-circuits the initial render —
        // the page never paints, the browser is sent straight on (e.g. a landing page that
        // forwards "/" to "/dashboard", or a server-side auth bounce). Without this, the
        // redirect was only honoured on WebSocket actions and silently ignored on first GET.
        if (page._redirectUrl) {
          http.redirect(page._redirectUrl, _redirectStatus(page._redirectStatus));
          return;
        }

        // Fill @presence member lists before the first paint (the client refreshes them on
        // join/leave thereafter). No-op unless the component has @presence props.
        await populatePresence(page);

        // Refill @shared props from the room store before the first paint (seeding the store
        // with the default when the room is new). No-op unless the component has @shared props.
        populateShared(page);

        const innerHtml = await _renderFlowPage(page, () => page.render());

        // dehydrate() hook runs at the end of the request, before serialisation.
        await page.onDehydrate();
        const snapshot = dehydrate(page, { id: compId, name: compName, path });
        warnIfLarge(snapshot, compName);

        // Persist the durable snapshot (or clear it if clearDurable() was called). No-op unless
        // the component opted into `static durable`.
        await persistDurable(page, ctx, snapshot);

        // toScriptJson, not JSON.stringify: the snapshot carries @expose/@locked values and
        // @url props seeded from the query string, so it routinely holds attacker-controlled
        // strings that would otherwise close the <script> island. See toScriptJson's docblock.
        const snapshotJson = toScriptJson(snapshot);

        // The flow component root — always the same wrapper regardless of layout.
        const flowRoot: HtmlNode = {
          html: `<div data-flow-root x-data="{}" data-flow-id="${compId}" data-flow-name="${compName}">${innerHtml}</div>`,
        };

        // Layout resolution. The JSX-native `layout(page)` instance hook wins; otherwise
        // fall back to the legacy `static layout = SomeLayout` class. Both wrap the root in
        // a [data-flow-layout] marker so the client navigate logic swaps only the
        // [data-flow-root] on same-layout navigations (a full navigation otherwise).
        let bodyContent: string;
        let layoutHead = "";

        const wrapped = await page.layout(flowRoot);
        const LayoutClass = (PageClass as PageClassWithLayout).layout;

        if (wrapped !== flowRoot) {
          // JSX-native layout. If the layout component declared its own identity
          // (data-flow-layout on its root), honour it — that's the robust way to keep the
          // shell persistent across navigations, especially when the wrapper passes
          // page-specific props. Otherwise fall back to a source-derived id, which matches
          // for identical wrappers like `(page) => <AppLayout>{page}</AppLayout>`.
          bodyContent = /\bdata-flow-layout\b/.test(wrapped.html)
            ? wrapped.html
            : `<div data-flow-layout="${_layoutId(page)}">${wrapped.html}</div>`;
        } else if (LayoutClass) {
          const layout = new LayoutClass();
          const layoutNode = await layout.render(flowRoot);
          bodyContent = `<div data-flow-layout="${LayoutClass.name}">${layoutNode.html}</div>`;
          layoutHead = (LayoutClass as { head?: string }).head ?? "";
        } else {
          bodyContent = flowRoot.html;
        }

        const titleTag = PageClass.title ? `<title>${PageClass.title}</title>` : "";
        // Component head takes precedence; layout head provides global resources.
        const headExtra = [PageClass.head ?? "", layoutHead].filter(Boolean).join("\n  ");

        const runtimeSrc = _runtimeJs() ? "/__flow/runtime.js" : "";
        const runtimeTag = runtimeSrc ? `<script src="${runtimeSrc}" defer></script>` : "";

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>[flow\\:cloak],[x-cloak]{display:none!important}[flow\\:loading]{display:none}@media (prefers-reduced-motion:reduce){[flow\\:transition]{transition:none!important}::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important}}</style>
  ${titleTag}
  ${headExtra}
</head>
<body>
  ${bodyContent}
  <script type="application/json" id="flow-state-${compId}">${snapshotJson}</script>
  ${runtimeTag}
</body>
</html>`;

        http.html(html);
      } catch (error) {
        // Only UNEXPECTED throws get the dev overlay. Intended HTTP errors — auth (401/403), 404,
        // validation, and redirects thrown as errors — carry a numeric `status` and must keep
        // flowing to the framework's error handler. Production rethrows everything (no stack leak).
        const intended = typeof (error as { status?: unknown } | null)?.status === "number";
        if (!_IS_DEV_WORKER || intended) throw error;
        http.response = new Response(_renderBootErrorPage(error, PageClass.name), {
          status: 500,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }
  };
}

/** True under the `serve --dev` worker — gates the dev-only initial-render error overlay. */
const _IS_DEV_WORKER = Bun.argv.includes("--dev-worker");

/**
 * Dev-only: a minimal HTML page that boots the flow runtime and shows the error overlay for an
 * error thrown during the initial GET render. The detail rides an embedded JSON `<script>` the
 * bridge reads on load. Never used in production — the handler rethrows there.
 * @internal exported for tests.
 */
export function _renderBootErrorPage(error: unknown, compName: string): string {
  const e = error instanceof Error ? error : new Error(String(error));
  // Shares toScriptJson with the main state island — same hazard, one implementation.
  const boot = toScriptJson({
    name: e.name || "Error",
    message: e.message,
    stack: e.stack,
    action: "initial render",
    component: compName,
  });
  const runtimeTag = _runtimeJs() ? `<script src="/__flow/runtime.js" defer></script>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Error — ${compName}</title></head>
<body>
  <script type="application/json" id="flow-boot-error">${boot}</script>
  ${runtimeTag}
</body>
</html>`;
}

/** Narrow the advisory status from redirect() to the HTTP redirect codes, defaulting to 302. */
function _redirectStatus(status: number | null): 301 | 302 | 303 | 307 | 308 {
  switch (status) {
    case 301:
    case 303:
    case 307:
    case 308:
      return status;
    default:
      return 302;
  }
}

// ── @url seeding ──────────────────────────────────────────────────────────────

/** Seed @url properties from the request query string before onMount(). */
function _seedUrlProps(page: Component, request: Request): void {
  const urlProps = getUrlProps(page);
  if (urlProps.size === 0) return;

  const params = new URL(request.url).searchParams;
  for (const [prop, opts] of urlProps) {
    const paramName = opts.as ?? prop;
    const raw = params.get(paramName);
    if (raw === null) continue;

    // Coerce to the existing type
    const current = (page as unknown as Record<string, unknown>)[prop];
    if (typeof current === "number") {
      const n = Number(raw);
      if (!isNaN(n)) (page as unknown as Record<string, unknown>)[prop] = n;
    } else if (typeof current === "boolean") {
      (page as unknown as Record<string, unknown>)[prop] = raw === "1" || raw === "true";
    } else {
      (page as unknown as Record<string, unknown>)[prop] = raw;
    }
  }
}

// ── @param seeding ────────────────────────────────────────────────────────────

/**
 * Seed `@param` properties from the matched route segments before onMount().
 *
 * Initial GET only — that is the sole request carrying the URL's segments, and the only
 * one where route-model bindings are resolved. WebSocket round-trips rebuild the context
 * from the stored route *pattern* (so `ctx.params` is empty) and restore these fields from
 * the snapshot instead, models included via the model synth. Calling this on that path
 * would overwrite a hydrated value with nothing.
 */
export function _seedRouteParams(page: Component, ctx: HttpContext): void {
  const params = ctx.params as Record<string, unknown>;
  if (!params) return;

  const target = page as unknown as Record<string, unknown>;
  const explicit = getRouteParamProps(page);

  // Implicit: a serialized field whose name matches a route segment is filled from it —
  // `@locked post` on `/posts/:post` receives the model the router already resolved, with
  // nothing to declare. Only names the route actually matched are touched.
  for (const prop of [...getLockedProps(page), ...getExposedProps(page)]) {
    if (explicit.has(prop)) continue; // an explicit @param mapping wins
    const value = params[prop];
    if (value !== undefined) target[prop] = value;
  }

  // Explicit: @param — a named segment, or a model class matched against the resolved
  // segment values so the field never has to know what the route called it.
  for (const [prop, source] of explicit) {
    const value =
      typeof source === "function" ? _paramOfType(params, source) : params[source ?? prop];
    if (value !== undefined) target[prop] = value;
  }
}

/**
 * The first resolved segment that is an instance of `Model`.
 *
 * Segment order is the route's, so a path binding the same model twice
 * (`/users/:user/friends/:friend`) yields the leftmost — name that one with
 * `@param("friend")` instead.
 */
function _paramOfType(params: Record<string, unknown>, Model: ParamModel): unknown {
  for (const value of Object.values(params)) {
    if (value instanceof Model) return value;
  }
  return undefined;
}

// ── @session seeding / persisting ─────────────────────────────────────────────

type SessionLike = {
  has(k: string): boolean;
  get(k: string): unknown;
  set(k: string, v: unknown): void;
};

/** Resolve the session from ctx — avoids the facade / ALS chain. */
function _getSession(ctx: HttpContext): SessionLike | undefined {
  return (ctx as unknown as { session?: SessionLike }).session;
}

/** Seed @session properties from the session store before onMount(). */
function _seedSessionProps(page: Component, className: string, ctx: HttpContext): void {
  const sessionProps = getSessionProps(page);
  if (sessionProps.size === 0) return;
  const session = _getSession(ctx);
  if (!session) return;
  for (const [prop, opts] of sessionProps) {
    const key = sessionKeyFor(prop, opts, className);
    if (session.has(key)) {
      (page as unknown as Record<string, unknown>)[prop] = session.get(key);
    }
  }
}

/** Persist @session properties back to the session store after onMount/actions. */
export function _persistSessionProps(page: Component, className: string, ctx: HttpContext): void {
  const sessionProps = getSessionProps(page);
  if (sessionProps.size === 0) return;
  const session = _getSession(ctx);
  if (!session) return;
  for (const [prop, opts] of sessionProps) {
    const key = sessionKeyFor(prop, opts, className);
    session.set(key, (page as unknown as Record<string, unknown>)[prop]);
  }
}
