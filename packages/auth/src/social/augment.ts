// Augment the core RouterMacros interface so Router.social() is fully typed.
declare module "@zerotal/core" {
  interface RouterMacros {
    /**
     * Register the three standard social-auth routes for a given prefix.
     *
     * Expands to:
     *   GET  {prefix}/:provider             → controller.redirect
     *   GET  {prefix}/:provider/callback    → controller.callback
     *   POST {prefix}/:provider/callback    → controller.callback  (Apple form_post)
     *
     * @example
     * Router.social('/auth', SocialController);
     */
    social(prefix: string, controller: new (...args: unknown[]) => unknown): void;
  }
}

export {};
