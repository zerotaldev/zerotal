/**
 * The endpoint behind the error page's "Run migrations" button.
 *
 * This mutates a database in response to a request originating from a page that
 * was rendered by a GET, which is a shape worth being paranoid about: a dev
 * server on `localhost:3000` is reachable by any site the developer has open in
 * another tab, and "run every pending migration" is not something a random page
 * should be able to trigger.
 *
 * So it carries three independent guards, and each is checked here rather than
 * inferred from the fact that the overlay is dev-only:
 *
 * 1. **`devSurfacesEnabled()`**, decided at request time. Note this is not
 *    `!isProdLike(...)`: `isProdLike("")` is false, so an unset `APP_ENV` would
 *    have *passed* that check. This one fails closed — only an explicitly
 *    non-production environment, or a process the dev orchestrator supervises,
 *    qualifies. It also reads the right thing: `setAppEnv()` overwrites
 *    `APP_ENV` with a runtime mode before boot, so reading it directly is wrong.
 * 2. **A single-use token**, minted per error page and spent on first use. This
 *    is what a cross-origin caller cannot obtain: it would have to read the
 *    page, and the same-origin policy stops it.
 * 3. **The origin guard**, the same one the raw Flow endpoints use — because
 *    this is registered as a raw route and so sits outside the CSRF middleware.
 *
 * The route is registered only when dev surfaces are enabled, so in production it
 * does not exist at all. Guard 1 is the belt to that braces.
 */
import { Router, devSurfacesEnabled } from "@zerotal/core";
import { isAllowedOrigin } from "@zerotal/core/http";
import { loadMigrations } from "../commands/_loadMigrations.ts";
import { MigrationRunner } from "../schema/MigrationRunner.ts";
import type { MigrationEntry } from "../schema/MigrationRunner.ts";
import { _getConnection } from "../db/DB.ts";

/** Path the button posts to. */
export const RUN_MIGRATIONS_PATH = "/__zerotal/run-migrations";
/** Header carrying the single-use token. */
const TOKEN_HEADER = "X-Zerotal-Diagnosis-Token";

/**
 * Outstanding tokens.
 *
 * In memory and per process, which is right: a token is only ever handed to the
 * page this process just rendered, and a restart invalidating them is correct
 * rather than inconvenient — the page is stale by then anyway.
 */
const _tokens = new Set<string>();
/** Tokens outlive one render but not a session; a bounded set cannot grow without limit. */
const MAX_TOKENS = 32;

/** Mint a token for one error page. @internal */
export function _mintDiagnosisToken(): string {
  // The oldest token is dropped rather than letting a long dev session
  // accumulate them. Insertion order is iteration order for a Set.
  if (_tokens.size >= MAX_TOKENS) {
    const oldest = _tokens.values().next().value;
    if (oldest !== undefined) _tokens.delete(oldest);
  }
  const token = crypto.randomUUID();
  _tokens.add(token);
  return token;
}

/** Spend a token. Returns false when it was never minted, or was already used. @internal */
export function _spendDiagnosisToken(token: string | null): boolean {
  if (!token) return false;
  return _tokens.delete(token);
}

/** Forget every outstanding token. Tests. @internal */
export function _resetDiagnosisTokens(): void {
  _tokens.clear();
}

/**
 * Run every pending migration, and report what ran.
 *
 * Separated from the route so a test can drive it without a server.
 */
export async function _runPendingMigrations(): Promise<string[]> {
  const records = await loadMigrations();
  const entries: MigrationEntry[] = records.map((r) => ({ name: r.name, migration: r.instance }));
  const runner = new MigrationRunner({ connection: _getConnection() });
  return runner.run(entries);
}

/**
 * Register the endpoint, unless this is production.
 *
 * Called from `DatabaseProvider.onRegister()`.
 */
export function registerRunMigrationsEndpoint(allowedOrigins: () => string[]): void {
  if (!devSurfacesEnabled()) return;

  Router.raw("POST", RUN_MIGRATIONS_PATH, async (req: Request): Promise<Response> => {
    // Guard 1 — re-checked at request time, not inherited from registration.
    if (!devSurfacesEnabled()) {
      return new Response("Not available.", { status: 404 });
    }

    // Guard 2 — a raw route bypasses the middleware pipeline, so CSRF protection
    // does not apply and this is the check standing in for it.
    if (!isAllowedOrigin(req, allowedOrigins())) {
      return new Response("Forbidden origin.", { status: 403 });
    }

    // Guard 3 — single use. A caller that cannot read the error page cannot have
    // this, and replaying a captured one does not work twice.
    if (!_spendDiagnosisToken(req.headers.get(TOKEN_HEADER))) {
      return new Response("Invalid or already-used token.", { status: 403 });
    }

    try {
      const ran = await _runPendingMigrations();
      if (ran.length === 0) return new Response("Nothing to run.", { status: 200 });
      return new Response(`Ran ${ran.length}: ${ran.join(", ")}`, { status: 200 });
    } catch (error) {
      // The migration itself failed — which is a real answer, and more useful
      // than a generic 500. It goes back as text so the panel can show it.
      const message = error instanceof Error ? error.message : String(error);
      return new Response(`Migration failed: ${message}`, { status: 500 });
    }
  });
}
