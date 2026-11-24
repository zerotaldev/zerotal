/**
 * The signed-in user as a page sees it: the model's own `toJSON()`, so every column in
 * `static hidden` (the password hash, the two-factor secret) is already gone.
 */
export interface AuthUser {
  id: number;
  name: string;
  email: string;
  /** When the address was confirmed; null until the link in the email is clicked. */
  emailVerifiedAt: string | null;
  /** When two-factor was turned on; null while it is off. */
  twoFactorConfirmedAt: string | null;
}

/**
 * Props `@zerotal/inertia` merges into every page, so no controller has to pass
 * them. Type `usePage<SharedProps>()` with this to read them safely.
 *
 * Add your own here after registering them with `Inertia.share(...)`.
 */
export interface SharedProps {
  /** Shared by app/providers/AppServiceProvider.ts. `name` comes from config/app.ts. */
  app: { name: string };
  /** Optional features, and whether they are switched on (also from AppServiceProvider). */
  features: { passkeys: boolean };
  /** The signed-in user, or null. Populated once an auth provider is registered. */
  auth: { user: AuthUser | null };
  /** One-request-only messages set with `http.flash("success" | "error" | "warning" | "info", …)`. */
  flash: { success: string | null; error: string | null; warning: string | null; info: string | null };
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
    app: { name: string };
    features: { passkeys: boolean };
    auth: { user: AuthUser | null };
  }
}

/** The example resource. Remove with it — see "Remove the example" in the README. */
export type ProjectStatus = "planning" | "active" | "completed";

/** A project as the server sends it (app/models/Project.ts, `toPage()`). */
export interface Project {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  updatedAt: string | null;
}

/** One page of a list, and where it sits in the whole. */
export interface Pagination {
  page: number;
  lastPage: number;
  total: number;
  from: number | null;
  to: number | null;
}
