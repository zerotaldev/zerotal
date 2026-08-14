import type { MiddlewareClass, RouteRegistration } from "@zerotal/core";
import type { PageTarget, RenderProps } from "./pages.ts";

declare module "@zerotal/core" {
  interface RouterMacros {
    /**
     * Register a GET route that renders an Inertia page without a controller.
     *
     * The component name and props are checked against the generated page
     * registry, exactly as `Inertia.render` is.
     *
     * @example
     * Router.inertia('/about', 'About/Index');
     * Router.inertia('/home',  'Home/Index', { greeting: 'Hello' });
     * Router.inertia('/admin', 'Admin/Dashboard', [AuthMiddleware]);
     */
    inertia<N extends PageTarget>(
      path: string,
      component: N,
      props?: RenderProps<N> | MiddlewareClass[],
      middleware?: MiddlewareClass[],
    ): RouteRegistration;
  }
}

export {};
