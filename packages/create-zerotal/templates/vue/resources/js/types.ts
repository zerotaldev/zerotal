/**
 * Props `@zerotal/inertia` merges into every page, so no controller has to pass
 * them. Type `usePage<SharedProps>()` with this to read them safely.
 *
 * Add your own here after registering them with `Inertia.share(...)`.
 */
export interface SharedProps {
  /** The signed-in user, or null. Populated once an auth provider is registered. */
  auth: { user: { id: number; name: string; email: string } | null };
  /** One-request-only messages set with `http.flash("success" | "error", …)`. */
  flash: { success: string | null; error: string | null };
  /** Field errors from a failed `validate()` call, keyed by field name. */
  errors: Record<string, string>;
  /** Submitted input from a failed `validate()`, so a form can repopulate itself. */
  old: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * The same list, told to the server side. `Inertia.render(page, props)` checks a
 * controller's props against the page component's own props — so without this,
 * a page that reads `auth` through `usePage()` would look to the server like a
 * page whose controller forgot to pass it.
 *
 * `share()` is a runtime call in a provider, so nothing can generate this: when
 * you register a new shared prop, add it in both places.
 */
declare module "@zerotal/inertia" {
  interface SharedProps {
    auth: { user: { id: number; name: string; email: string } | null };
  }
}
