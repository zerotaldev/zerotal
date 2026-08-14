import { Router } from "@zerotal/core";
import type { MiddlewareClass, RouteRegistration } from "@zerotal/core";
import { inertia } from "./inertia.ts";
import type { PageTarget, RenderProps } from "./pages.ts";

/**
 * Register a GET route that renders an Inertia page directly — no controller
 * needed for controller-less pages.
 *
 * Useful for static/simple pages (about, dashboards) that need no controller logic —
 * the generated handler just calls {@link inertia} with the given component and props.
 *
 * @param path - The URL path to register (GET).
 * @param component - The page component name/path (relative to the pages dir, no extension).
 * @param props - Static props object, **or** a middleware array as a shorthand (when it's an array it's treated as middleware, not props).
 * @param middleware - Middleware to apply (ignored when `props` is used as the middleware-array shorthand).
 * @returns The route registration from the underlying `Router.get`.
 *
 * @example
 * ```ts
 * Router.inertia('/about', 'About/Index');
 * Router.inertia('/home',  'Home/Index', { greeting: 'Hello' });
 * Router.inertia('/admin', 'Admin/Dashboard', [AuthMiddleware]);
 * ```
 */
export function inertiaRoute<N extends PageTarget>(
  path: string,
  component: N,
  props?: RenderProps<N> | MiddlewareClass[],
  middleware: MiddlewareClass[] = [],
): RouteRegistration {
  let resolvedProps: Record<string, unknown> = {};
  let resolvedMiddleware: MiddlewareClass[] = middleware;

  if (Array.isArray(props)) {
    resolvedMiddleware = props; // shorthand: Router.inertia('/x', 'X', [AuthMiddleware])
  } else if (props) {
    resolvedProps = props as Record<string, unknown>;
  }

  const handler = class InertiaRouteHandler {
    async handle(): Promise<void> {
      // Props were checked against the component above; the runtime call takes
      // the erased bag, which `RenderProps<N>` cannot be proven to be while `N`
      // is still a type variable.
      await inertia.dynamic(component, resolvedProps);
    }
  };

  return Router.get(path, handler, "handle", resolvedMiddleware);
}
