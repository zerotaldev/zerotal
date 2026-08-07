import { deepMerge } from "@zerotal/core";
import type { MiddlewareClass } from "@zerotal/core";
import type { AdminThemeConfig } from "./theme.ts";
import type { AdminAuthorizer } from "./support/ability.ts";

/** A single entry in the top-bar user menu. */
export interface UserMenuItem {
  label: string;
  href: string;
  icon?: string;
}

/** Top-bar user menu (avatar/identity dropdown). */
export interface UserMenu {
  /** Heading shown at the top of the menu (e.g. the signed-in user's name). */
  label?: string;
  items: UserMenuItem[];
}

/**
 * Auth-pages configuration. When `enabled`, the panel mounts a login screen
 * (using `@zerotal/auth`'s `Auth.attempt`) and an in-panel profile page (update
 * details + change password + sign out). Password-reset and email-verification
 * pages are mounted when their broker hooks are supplied (the admin owns the UI;
 * the app supplies the data — same split as the notification provider).
 */
export interface AdminAuthConfig {
  /** Mount the auth pages. */
  enabled?: boolean;
  /** Login route (relative to the panel path). Default `/login`. */
  loginPath?: string;
  /** Profile route (relative to the panel path). Default `/profile`. */
  profilePath?: string;
  /** Where to send the user after a successful login. Default the panel root. */
  redirectTo?: string;
  /** The credential column users log in with. Default `"email"`. */
  identifier?: string;
  /** Show a "remember me" checkbox. Default `true`. */
  remember?: boolean;
  /** Heading on the auth screens. Defaults to the panel brand. */
  heading?: string;
  /** Extra gate after the password check (e.g. "is the account active?"). */
  authenticateWhen?: (user: unknown) => boolean | Promise<boolean>;
  /** Persist profile edits (name/email). Defaults to `user.fill(data); user.save()`. */
  updateProfile?: (user: unknown, data: Record<string, unknown>) => Promise<void> | void;
  /** Middleware guarding the guest screens (login/forgot/reset). Default none. */
  guestMiddleware?: MiddlewareClass[];
  /** Middleware guarding the profile/verify screens. Defaults to the panel guard. */
  authMiddleware?: MiddlewareClass[];
  /** Password-reset broker — mounting the forgot/reset pages when provided. */
  passwordReset?: {
    sendResetLink(email: string): Promise<boolean> | boolean;
    reset(input: { email: string; token: string; password: string }): Promise<boolean> | boolean;
  };
  /** Email-verification hooks — mounting the verify page when provided. */
  emailVerification?: {
    isVerified(user: unknown): boolean;
    resend(user: unknown): Promise<void> | void;
  };
}

/** Admin panel configuration (read from `config/admin.ts`, with defaults). */
export interface AdminConfigShape {
  /** URL prefix the panel mounts under. */
  path: string;
  /** Brand name shown in the sidebar. */
  brand: string;
  /** Optional short tagline under the brand. */
  tagline?: string;
  /**
   * Middleware guarding every panel route. When left empty, the panel is
   * default-denied in production-like environments (fail closed) and open only
   * for local exploration (`APP_ENV=development|local|test`). Set an
   * auth/authorization middleware before shipping to production, e.g.
   * `[AuthMiddleware.with({ ... })]`. To deliberately expose it without auth,
   * pass an explicit pass-through middleware.
   */
  middleware?: MiddlewareClass[];
  /** Optional top-bar user menu (Profile / Logout / …). */
  userMenu?: UserMenu;
  /** Styling source — Tailwind Play CDN (default) or a prebuilt stylesheet. */
  theme?: AdminThemeConfig;
  /** Auth pages (login / profile / password-reset / email-verification). */
  auth?: AdminAuthConfig;
  /**
   * Decide the abilities named by pages, widgets, nav entries and search
   * providers. Set this when the app models permissions itself; leave it unset to
   * resolve through `@zerotal/auth`'s Gate when that package is installed.
   *
   * With neither configured, every ability is denied outside a development
   * environment — a panel with no authorization wired stays closed in production.
   */
  authorize?: AdminAuthorizer;
  /**
   * Switch contributing packages off by id — `{ monitor: false }` keeps the
   * monitor provider installed but drops its pages, widgets and nav entries from
   * the panel. Anything absent here is on.
   */
  plugins?: Record<string, boolean>;
}

export const DEFAULT_ADMIN_CONFIG: AdminConfigShape = {
  path: "/admin",
  brand: "Zerotal",
  tagline: "Admin",
  middleware: [],
};

/**
 * Create a typed admin configuration object with defaults. Function-valued
 * fields (middleware classes, `authorize`, the auth hooks) pass through by
 * reference — deepMerge treats them as atomic values.
 *
 * @example
 * // config/admin.ts
 * import { AdminConfig } from '@zerotal/admin';
 * export default AdminConfig({ path: '/admin', brand: 'Acme', middleware: [AuthMiddleware] });
 */
export function AdminConfig(options: Partial<AdminConfigShape> = {}): AdminConfigShape {
  return deepMerge(DEFAULT_ADMIN_CONFIG, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    admin: AdminConfigShape;
  }
}
