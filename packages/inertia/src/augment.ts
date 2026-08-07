import type { MiddlewareClass, RouteRegistration } from "@zerotal/core";

declare module "@zerotal/core" {
  interface RouterMacros {
    /**
     * Register a GET route that renders an Inertia page without a controller.
     *
     * @example
     * Router.inertia('/about', 'About/Index');
     * Router.inertia('/home',  'Home/Index', { greeting: 'Hello' });
     * Router.inertia('/admin', 'Admin/Dashboard', [AuthMiddleware]);
     */
    inertia(
      path: string,
      component: string,
      props?: Record<string, unknown> | MiddlewareClass[],
      middleware?: MiddlewareClass[],
    ): RouteRegistration;
  }
}

export {};
