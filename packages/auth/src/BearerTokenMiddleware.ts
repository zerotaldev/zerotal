import type { NextFn, HttpContext } from "@zerotal/core";
import { BaseMiddleware, FrameworkEvents } from "@zerotal/core";
import { LoginFailed } from "./events.ts";
import { hashToken, tokenCan, type TokenRow } from "./PersonalAccessToken.ts";

export type TokenLoader = (hash: string) => Promise<TokenRow | null>;
/** Optional hook called after a valid token is used — updates `last_used_at`. */
export type TokenToucher = (id: number) => Promise<void>;

/**
 * Reads `Authorization: Bearer <token>` from the request, hashes it, looks the
 * matching {@link TokenRow} up via the registered loader, and — if the token is
 * found and unexpired — sets `ctx.user` and attaches a `ctx.tokenCan(ability)`
 * helper.
 *
 * @remarks
 * This is a **populate** step, not a gate: it never rejects a request. An absent
 * or invalid token simply leaves `ctx.user` unset (guard the route separately with
 * `AuthMiddleware`), while a valid one also fires the optional `setToucher` hook
 * (fire-and-forget) to update `last_used_at`. The presented plaintext is SHA-256
 * hashed with {@link hashToken} before lookup — only hashes are compared, matching
 * how {@link createToken} stores them. Failed lookups emit a `LoginFailed`
 * framework event (`invalid_token` or `expired_token`).
 *
 * Register a token loader once in a ServiceProvider:
 *
 * @example
 * ```ts
 * // In AuthProvider.onBooted():
 * BearerTokenMiddleware.setLoader(async (hash) => {
 *   return PersonalAccessToken.query().where('token', hash).first();
 * });
 *
 * // On routes that require API auth:
 * Router.group({ middleware: [BearerTokenMiddleware] }, () => {
 *   Router.resource('posts', PostController);
 * });
 *
 * // Check abilities in a controller:
 * if (!ctx.tokenCan('write')) {
 *   ctx.response = Response.json({ message: 'Forbidden' }, { status: 403 });
 *   return;
 * }
 * ```
 */
export class BearerTokenMiddleware extends BaseMiddleware {
  protected options: {} = {};

  private static _loader: TokenLoader | undefined;
  private static _toucher: TokenToucher | undefined;

  static setLoader(loader: TokenLoader): void {
    BearerTokenMiddleware._loader = loader;
  }

  /**
   * Register a callback that fires (fire-and-forget) after a valid token is used.
   * Use this to update `last_used_at` in the database.
   *
   * @example
   * ```ts
   * // In AuthProvider.onBooted():
   * BearerTokenMiddleware.setToucher(async (id) => {
   *   await DB.table('personal_access_tokens')
   *     .where('id', id)
   *     .update({ last_used_at: new Date().toISOString() });
   * });
   * ```
   */
  static setToucher(toucher: TokenToucher): void {
    BearerTokenMiddleware._toucher = toucher;
  }

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const auth = http.request.headers.get("Authorization") ?? "";

    if (auth.startsWith("Bearer ")) {
      const plaintext = auth.slice(7).trim();
      if (plaintext && BearerTokenMiddleware._loader) {
        const hash = await hashToken(plaintext);
        const tokenRow = await BearerTokenMiddleware._loader(hash);

        if (tokenRow && !_isExpired(tokenRow)) {
          // Attach user-like object — callers can type-assert to their user shape
          http.user = {
            id: tokenRow.tokenable_id,
            _token: tokenRow,
          } as unknown as typeof http.user;
          // Attach tokenCan helper as a function on the context
          (http as unknown as Record<string, unknown>)["tokenCan"] = (ability: string) =>
            tokenCan(tokenRow, ability);

          // Touch last_used_at in the background — fire-and-forget to avoid latency
          if (BearerTokenMiddleware._toucher) {
            void BearerTokenMiddleware._toucher(tokenRow.id).catch(() => {});
          }
        } else if (tokenRow) {
          FrameworkEvents.emit(new LoginFailed("api", String(tokenRow.id), "expired_token", http));
        } else {
          FrameworkEvents.emit(new LoginFailed("api", "", "invalid_token", http));
        }
      }
    }

    return next();
  }
}

/** @internal True when the row carries an `expires_at` that is now in the past. */
function _isExpired(row: TokenRow): boolean {
  if (!row.expires_at) return false;
  return new Date(row.expires_at) < new Date();
}
