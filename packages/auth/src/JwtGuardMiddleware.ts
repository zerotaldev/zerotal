import type { NextFn, HttpContext } from "@zerotal/core";
import { BaseMiddleware } from "@zerotal/core";
import { Jwt, type JwtPayload } from "./Jwt.ts";

export interface JwtGuardOptions {
  /** HMAC secret. Defaults to `JWT_SECRET`, then `APP_KEY`, from the environment. */
  secret?: string | undefined;
  /** Resolve a user from the verified token claims. Required to populate `ctx.user`. */
  resolve?: ((claims: JwtPayload) => Promise<unknown> | unknown) | undefined;
  /** Header carrying the token. Default `authorization` (with a `Bearer ` prefix). */
  header?: string | undefined;
}

/**
 * Authenticate a request from a stateless HS256 JWT bearer token (a populate
 * step, like `BearerTokenMiddleware` / `PersistUserMiddleware` — it never blocks;
 * guard the route with `AuthMiddleware`).
 *
 * Reads the bearer token, verifies it with {@link Jwt}, and sets `ctx.user` from
 * the `resolve` callback. Provide `secret` and `resolve` via `.with(...)`:
 *
 * @remarks
 * When `secret` is omitted it falls back to `JWT_SECRET`, then `APP_KEY`, from the
 * environment. If neither a secret nor a `resolve` callback is available the
 * middleware is a no-op (the request passes through unauthenticated). A token that
 * fails {@link Jwt.verify} — malformed, non-HS256, tampered, wrong-secret, or
 * expired — leaves `ctx.user` unset rather than throwing.
 *
 * @example
 * ```ts
 * const JwtGuard = JwtGuardMiddleware.with({
 *   secret: Bun.env.JWT_SECRET!,
 *   resolve: (claims) => User.find(Number(claims.sub)),
 * });
 * Router.get("/api/me", MeController, "show", [JwtGuard, AuthMiddleware]);
 * ```
 */
export class JwtGuardMiddleware extends BaseMiddleware<JwtGuardOptions> {
  protected options: JwtGuardOptions = {};

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const secret = this.options.secret ?? Bun.env["JWT_SECRET"] ?? Bun.env["APP_KEY"];
    const resolve = this.options.resolve;
    const headerName = this.options.header ?? "authorization";

    if (secret && resolve) {
      const raw = http.request.headers.get(headerName) ?? "";
      const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
      if (token) {
        const claims = Jwt.verify(token, secret);
        if (claims) {
          const user = await resolve(claims);
          if (user) http.user = user as never;
        }
      }
    }

    return next();
  }
}
