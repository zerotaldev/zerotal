/**
 * The login-time half of the auth security model: which privileges a session may hold,
 * and when they are earned or surrendered.
 *
 * Each case here failed against the pre-fix implementation. They are grouped by the
 * property they protect rather than by the function under test, because the defects they
 * cover were all "the control exists somewhere else" — the session survived logout, the
 * second factor was enforced only where a developer remembered to attach middleware.
 */
import { describe, it, expect } from "bun:test";
import { RequestContext } from "@zerotal/core";
import { SessionManager } from "@zerotal/session";
import type { SessionDriver } from "@zerotal/session";
import { Auth } from "./facades/Auth.ts";
import { PersistUserMiddleware } from "./PersistUserMiddleware.ts";
import {
  TWO_FACTOR_SESSION_KEY,
  TWO_FACTOR_PENDING_KEY,
  TwoFactorMiddleware,
} from "./TwoFactorMiddleware.ts";
import { PASSWORD_CONFIRMED_AT_KEY } from "./ConfirmPasswordMiddleware.ts";

interface FakeUser {
  id: number;
  twoFactorSecret?: string | null;
  twoFactorConfirmedAt?: Date | null;
  getAuthId(): number;
  setRememberToken?(v: string | null): void;
  save?(): Promise<unknown>;
}

function user(id: number, twoFactor = false): FakeUser {
  return {
    id,
    twoFactorSecret: twoFactor ? "SECRET" : null,
    twoFactorConfirmedAt: twoFactor ? new Date() : null,
    getAuthId: () => id,
    setRememberToken() {},
    save: async () => undefined,
  };
}

/** Persistence is irrelevant here — every assertion is about the in-memory session bag. */
const _noopDriver: SessionDriver = {
  loadFromRequest: async () => ({ id: crypto.randomUUID(), data: {} }),
  saveSession: async () => undefined,
};

/** A context carrying a real SessionManager, so regenerate/flush semantics are the real ones. */
function ctxWith(sessionData: Record<string, unknown> = {}) {
  const session = new SessionManager("session-id-1", { ...sessionData }, _noopDriver);
  return {
    session,
    user: undefined as FakeUser | undefined,
    _twoFactorPendingUser: undefined as FakeUser | undefined,
    response: undefined as Response | undefined,
    redirect(url: string) {
      this.response = Response.redirect(url, 302);
    },
    container: undefined,
  };
}

function inRequest<T>(ctx: ReturnType<typeof ctxWith>, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run(ctx as never, fn);
}

describe("session privileges do not outlive the identity that earned them", () => {
  it("logout discards the whole session bag, not just user_id", async () => {
    const ctx = ctxWith({
      user_id: 1,
      [TWO_FACTOR_SESSION_KEY]: true,
      [PASSWORD_CONFIRMED_AT_KEY]: Date.now(),
      cart: ["widget"],
    });
    ctx.user = user(1);

    await inRequest(ctx, () => Auth.logout());

    expect(ctx.session.get("user_id")).toBeUndefined();
    expect(ctx.session.get(TWO_FACTOR_SESSION_KEY)).toBeUndefined();
    expect(ctx.session.get(PASSWORD_CONFIRMED_AT_KEY)).toBeUndefined();
    expect(ctx.session.get("cart")).toBeUndefined();
  });

  it("logout rotates the session id so the pre-logout cookie is not the post-logout session", async () => {
    const ctx = ctxWith({ user_id: 1 });
    ctx.user = user(1);
    const before = ctx.session.id();

    await inRequest(ctx, () => Auth.logout());

    expect(ctx.session.id()).not.toBe(before);
  });

  it("a login cannot inherit the previous identity's completed 2FA challenge", async () => {
    // A completes TOTP, then logs out; the attacker knows A's password and signs in.
    const ctx = ctxWith({ user_id: 1, [TWO_FACTOR_SESSION_KEY]: true });

    await inRequest(ctx, () => Auth.login(user(2) as never));

    expect(ctx.session.get(TWO_FACTOR_SESSION_KEY)).toBeUndefined();
  });

  it("a login cannot inherit a confirmed-password window", async () => {
    const ctx = ctxWith({ user_id: 1, [PASSWORD_CONFIRMED_AT_KEY]: Date.now() });

    await inRequest(ctx, () => Auth.login(user(2) as never));

    expect(ctx.session.get(PASSWORD_CONFIRMED_AT_KEY)).toBeUndefined();
  });
});

describe("two-factor is a login gate, not a route gate", () => {
  it("a correct password alone does not produce an authenticated session", async () => {
    const ctx = ctxWith();

    await inRequest(ctx, () => Auth.login(user(1, true) as never));

    expect(ctx.user).toBeUndefined();
    expect(ctx.session.get(TWO_FACTOR_PENDING_KEY)).toBe(true);
  });

  it("PersistUserMiddleware leaves ctx.user unset while the factor is outstanding", async () => {
    const ctx = ctxWith({ user_id: 1, [TWO_FACTOR_PENDING_KEY]: true });
    const target = user(1, true);

    class Loader extends PersistUserMiddleware {
      protected override async loadUser(): Promise<never> {
        return target as never;
      }
    }

    await inRequest(ctx, async () => {
      await new Loader().handle(ctx as never, async () => undefined);
    });

    // Every route, API endpoint and Flow action sees a guest…
    expect(ctx.user).toBeUndefined();
    // …while the challenge page can still identify who is half-way in.
    expect(ctx._twoFactorPendingUser).toBe(target);
    await inRequest(ctx, async () => {
      expect(Auth.pendingTwoFactorUser()).toBe(target as never);
    });
  });

  it("a user without a confirmed second factor logs in normally", async () => {
    const ctx = ctxWith();

    await inRequest(ctx, () => Auth.login(user(1) as never));

    expect(ctx.user).toBeDefined();
    expect(ctx.session.get(TWO_FACTOR_PENDING_KEY)).toBeUndefined();
  });

  it("an enrolled-but-unconfirmed secret does not gate the login", async () => {
    const half = user(1, true);
    half.twoFactorConfirmedAt = null;
    const ctx = ctxWith();

    await inRequest(ctx, () => Auth.login(half as never));

    expect(ctx.user).toBeDefined();
    expect(ctx.session.get(TWO_FACTOR_PENDING_KEY)).toBeUndefined();
  });

  it("completeTwoFactor promotes the user and rotates the session id", async () => {
    const ctx = ctxWith();
    const target = user(1, true);

    await inRequest(ctx, () => Auth.login(target as never));
    expect(ctx.user).toBeUndefined();

    ctx._twoFactorPendingUser = target;
    const idBeforeChallenge = ctx.session.id();
    const promoted = await inRequest(ctx, () => Auth.completeTwoFactor());

    expect(promoted).toBe(target as never);
    expect(ctx.user).toBe(target);
    expect(ctx.session.get(TWO_FACTOR_PENDING_KEY)).toBeUndefined();
    expect(ctx.session.get(TWO_FACTOR_SESSION_KEY)).toBe(true);
    expect(ctx.session.id()).not.toBe(idBeforeChallenge);
  });

  it("completeTwoFactor is inert when no challenge is pending", async () => {
    const ctx = ctxWith({ user_id: 1 });
    ctx._twoFactorPendingUser = user(1, true);

    const result = await inRequest(ctx, () => Auth.completeTwoFactor());

    expect(result).toBeNull();
    expect(ctx.session.get(TWO_FACTOR_SESSION_KEY)).toBeUndefined();
  });

  it("the remember cookie is withheld until the second factor lands", async () => {
    const ctx = ctxWith();
    const target = user(1, true);

    await inRequest(ctx, () => Auth.login(target as never, { remember: true }));
    expect((ctx as { _rememberMe?: unknown })._rememberMe).toBeUndefined();

    ctx._twoFactorPendingUser = target;
    await inRequest(ctx, () => Auth.completeTwoFactor());
    expect((ctx as { _rememberMe?: unknown })._rememberMe).toBeDefined();
  });

  it("TwoFactorMiddleware redirects a pending session rather than 401ing it", async () => {
    const ctx = ctxWith({ user_id: 1, [TWO_FACTOR_PENDING_KEY]: true });

    await new TwoFactorMiddleware().handle(ctx as never, async () => undefined);

    expect(ctx.response?.status).toBe(302);
    expect(ctx.response?.headers.get("location")).toContain(TwoFactorMiddleware.challengeRoute);
  });
});

describe("Auth.twoFactorPending", () => {
  it("reports the pending state inside a request", async () => {
    await inRequest(ctxWith(), async () => {
      expect(Auth.twoFactorPending()).toBe(false);
      await Auth.login(user(1, true) as never);
      expect(Auth.twoFactorPending()).toBe(true);
    });
  });
});
