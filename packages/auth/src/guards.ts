/**
 * Multiple authentication guards. Beyond the default session-backed `web` guard
 * (the top-level `Auth` facade), apps can define additional **request guards**
 * that resolve a user straight from the incoming request and reach them via
 * `Auth.guard(name)`.
 *
 * @example
 * import { Auth, Jwt } from "@zerotal/auth";
 *
 * Auth.viaRequest("api", async (req) => {
 *   const token = req.headers.get("authorization")?.replace("Bearer ", "");
 *   const claims = token && Jwt.verify<{ sub: number }>(token, process.env.JWT_SECRET!);
 *   return claims ? await User.find(claims.sub) : null;
 * });
 *
 * // In a controller:
 * const user = await Auth.guard("api").userOrNull();
 */
import { RequestContext, UnauthorizedError } from "@zerotal/core";

/**
 * Resolves a user (or null) from the incoming request for a request guard.
 *
 * @internal
 */
export type RequestGuardResolver = (request: Request) => unknown | Promise<unknown>;

/**
 * The common read surface every guard exposes (all async — guards may do I/O).
 * The default `web` guard adapts the session-based {@link Auth} facade; named
 * guards are {@link RequestGuard} instances registered via `Auth.viaRequest`.
 */
export interface Guard {
  /** The authenticated user; rejects with `UnauthorizedError` when there is none. */
  user(): Promise<unknown>;
  /** The authenticated user, or `undefined` when there is none. */
  userOrNull(): Promise<unknown>;
  /** The authenticated user's id, or `undefined` when there is none. */
  id(): Promise<number | string | undefined>;
  /** `true` when a user is authenticated on this guard. */
  check(): Promise<boolean>;
  /** `true` when no user is authenticated on this guard. */
  guest(): Promise<boolean>;
}

/** Registry of named request-guard resolvers (populated by `Auth.viaRequest`). */
export const requestGuards = new Map<string, RequestGuardResolver>();

interface CtxWithGuards {
  request: Request;
  _guards?: Record<string, unknown>;
}

/**
 * A stateless guard that resolves its user from the request on first access and
 * caches the result on the context for the rest of the request.
 *
 * @internal
 */
export class RequestGuard implements Guard {
  constructor(
    private readonly _name: string,
    private readonly _resolver: RequestGuardResolver,
  ) {}

  /**
   * Resolve the user from the request (cached per request), or `undefined`.
   */
  async userOrNull(): Promise<unknown> {
    const ctx = RequestContext.tryGet() as CtxWithGuards | undefined;
    if (!ctx) return undefined;
    const slots = (ctx._guards ??= {});
    if (this._name in slots) return slots[this._name] ?? undefined;
    const resolved = (await this._resolver(ctx.request)) ?? undefined;
    slots[this._name] = resolved;
    return resolved;
  }

  /**
   * The resolved user.
   *
   * @throws {UnauthorizedError} when the resolver yields no user.
   */
  async user(): Promise<unknown> {
    const u = await this.userOrNull();
    if (u === undefined) throw new UnauthorizedError("Not authenticated");
    return u;
  }

  async check(): Promise<boolean> {
    return (await this.userOrNull()) !== undefined;
  }

  async guest(): Promise<boolean> {
    return !(await this.check());
  }

  async id(): Promise<number | string | undefined> {
    const u = (await this.userOrNull()) as
      { getAuthId?(): number; id?: number | string } | undefined;
    return u?.getAuthId?.() ?? u?.id;
  }
}
