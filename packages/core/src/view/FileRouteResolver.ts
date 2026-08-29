import { Router } from "../router/Router.ts";
import {
  registerFileRouteResolver,
  enableFileRouteLayouts,
  type FileRouteContext,
} from "../router/FileRouter.ts";
import type { ViewComponent, ViewLayout, FileHandler } from "../router/Route.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { SafeHtml, isViewComponent } from "./jsx-runtime.ts";

function toHtml(value: unknown): string {
  if (value instanceof SafeHtml) return value.value;
  return value === null || value === undefined ? "" : String(value);
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- accepts any function narrowed from a route module's default export.
function isClass(fn: Function): boolean {
  return /^class[\s{]/.test(Function.prototype.toString.call(fn));
}

/**
 * Opt into rendering `.tsx`/`.jsx` file-route pages: a route file's default
 * export that is a view component (or any function tagged via the view marker)
 * is rendered to HTML, wrapped in the nearest `_layout`, and registered as a GET
 * route. Call from a provider's `onRegister()` before file routes are scanned.
 *
 * @internal
 */
export function registerViewFileRouteResolver(): void {
  enableFileRouteLayouts();

  registerFileRouteResolver((ctx: FileRouteContext): boolean => {
    const mod = ctx.module as { default?: unknown; GET?: unknown; layout?: ViewComponent | null };
    const component = mod.default;

    if (typeof component !== "function") return false;
    if (typeof mod.GET === "function") return false;
    if (isClass(component)) return false;

    const isJsxFile = /\.(tsx|jsx)$/.test(ctx.filePath);
    if (!isJsxFile && !isViewComponent(component)) return false;

    const resolvedLayout: ViewLayout | undefined =
      mod.layout !== undefined
        ? ((mod.layout ?? undefined) as ViewLayout | undefined)
        : (ctx.layout as ViewLayout | undefined);

    const page = component as ViewComponent;

    const handler: FileHandler = async (http: HttpContext): Promise<Response> => {
      const inner = toHtml(await page(http, http.params));
      const body = resolvedLayout
        ? toHtml(await resolvedLayout(http, { children: new SafeHtml(inner) }))
        : inner;
      return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    };

    Router._registerFileHandler("GET", ctx.urlPath, handler, ctx.middleware, ctx.name);
    return true;
  });
}
