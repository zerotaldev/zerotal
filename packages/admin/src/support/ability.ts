/**
 * Ability resolution for panel destinations.
 *
 * Resources, pages, widgets and nav entries each name an ability; the panel
 * consults it twice — once to decide whether to *draw* the entry, and again in
 * the route guard to decide whether to *serve* it. Drawing and serving share
 * this one resolver so a hidden destination is also an unreachable one.
 *
 * Resolution order, first match wins:
 *
 *   1. `authorize` in `config/admin.ts` — the app's own hook, for panels that
 *      model permissions themselves.
 *   2. The `gate` binding (`@zerotal/auth`'s `GateService`), resolved from the
 *      container by name so the auth package stays an optional dependency.
 *   3. Neither configured — allow only where dev surfaces are allowed. A panel
 *      with no authorization wired is closed in production-like environments,
 *      matching {@link AdminGuardMiddleware}'s posture.
 *
 * Rule 3 is what makes contributed pages safe to auto-register: a package can
 * put a page in the sidebar, but it cannot put one in front of a production user
 * who has no authorization configured.
 */
import { tryCurrentApp, devSurfacesEnabled } from "@zerotal/core";

/**
 * The slice of `@zerotal/auth`'s `GateService` the panel uses. Declared locally
 * and resolved by binding name, so admin never imports the auth package.
 *
 * The async form is deliberate: abilities that hit the database return a promise,
 * and the sync `allows()` treats a promise as truthy — which would wrongly allow.
 */
interface GateLike {
  allowsAsync(ability: string, model?: object): Promise<boolean>;
}

/** The app's own authorization hook, supplied as `authorize` in `config/admin.ts`. */
export type AdminAuthorizer = (ability: string) => boolean | Promise<boolean>;

/** Resolve the `gate` binding, or `undefined` when `@zerotal/auth` isn't installed. */
function gate(): GateLike | undefined {
  const app = tryCurrentApp();
  if (!app) return undefined;
  // `gate` is only a known binding when auth's module augmentation is loaded, which
  // admin does not import — resolve by name and re-type against the local shape.
  return app.container.tryMake("gate" as never) as GateLike | undefined;
}

/**
 * Whether the current user holds `ability`.
 *
 * An `undefined` ability means the destination declares no requirement of its own
 * and is governed solely by the panel guard — app-authored pages may do this;
 * package contributions may not (see {@link PageContribution}).
 *
 * Never throws: any error resolving the ability denies, so a broken policy closes
 * the door rather than opening it.
 */
export async function resolveAbility(
  ability: string | undefined,
  authorizer: AdminAuthorizer | undefined,
): Promise<boolean> {
  if (ability === undefined) return true;

  try {
    if (authorizer) return await authorizer(ability);
    const g = gate();
    if (g) return await g.allowsAsync(ability);
  } catch {
    return false;
  }

  return devSurfacesEnabled();
}
