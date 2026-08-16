import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "@zerotal/orm";
import { RequestContext, FrameworkEvents } from "@zerotal/core";
import {
  EmailVerified,
  PasswordResetLinkSent,
  PasswordReset as PasswordResetEvent,
} from "./events.ts";
import { HashService } from "./HashService.ts";
import { TwoFactorService } from "./TwoFactorService.ts";
import {
  ConfirmPasswordMiddleware,
  PASSWORD_CONFIRMED_AT_KEY,
} from "./ConfirmPasswordMiddleware.ts";
import {
  AuthenticateSessionMiddleware,
  AUTH_PASSWORD_HASH_KEY,
} from "./AuthenticateSessionMiddleware.ts";
import { BasicAuthMiddleware } from "./BasicAuthMiddleware.ts";
import { isPasswordCompromised } from "./CompromisedPassword.ts";
import { EmailOtpBroker } from "./EmailOtpBroker.ts";
import { Auth } from "./facades/Auth.ts";
import { Authenticatable } from "./Authenticatable.ts";
import { EmailVerification } from "./EmailVerification.ts";
import { PasswordBroker } from "./PasswordBroker.ts";

function makeSession(data: Record<string, unknown> = {}) {
  return {
    _data: data,
    get(k: string) {
      return this._data[k];
    },
    set(k: string, v: unknown) {
      this._data[k] = v;
    },
    forget(k: string) {
      delete this._data[k];
    },
    has(k: string) {
      return k in this._data;
    },
    flush() {
      this._data = {};
    },
  };
}

// ── Auto password rehash ─────────────────────────────────────────────────────────

describe("HashService.needsRehash", () => {
  it("argon2id service flags a bcrypt hash for rehash", async () => {
    const argon = new HashService("argon2id");
    const bcryptHash = await new HashService("bcrypt").make("pw");
    const argonHash = await argon.make("pw");
    expect(argon.needsRehash(bcryptHash)).toBe(true);
    expect(argon.needsRehash(argonHash)).toBe(false);
  });

  it("bcrypt service flags an argon2id hash for rehash", async () => {
    const bcrypt = new HashService("bcrypt");
    const argonHash = await new HashService("argon2id").make("pw");
    const bcryptHash = await bcrypt.make("pw");
    expect(bcrypt.needsRehash(argonHash)).toBe(true);
    expect(bcrypt.needsRehash(bcryptHash)).toBe(false);
  });
});

// ── ConfirmPasswordMiddleware ────────────────────────────────────────────────────

describe("ConfirmPasswordMiddleware", () => {
  const ctx = (session: ReturnType<typeof makeSession>, wantsJson = false) => ({
    session,
    response: undefined as Response | undefined,
    wantsJson: () => wantsJson,
    fullUrl: () => "http://localhost/settings",
    redirect(url: string, status = 302) {
      this.response = new Response(null, { status, headers: { Location: url } });
    },
  });

  it("passes through when the password was confirmed recently", async () => {
    const c = ctx(makeSession({ [PASSWORD_CONFIRMED_AT_KEY]: Date.now() }));
    let next = false;
    await new ConfirmPasswordMiddleware().handle(
      c as never,
      (async () => {
        next = true;
      }) as never,
    );
    expect(next).toBe(true);
    expect(c.response).toBeUndefined();
  });

  it("redirects to /confirm-password and stores intended_url when not confirmed", async () => {
    const c = ctx(makeSession());
    await new ConfirmPasswordMiddleware().handle(c as never, (async () => {}) as never);
    expect(c.response?.status).toBe(302);
    expect(c.response?.headers.get("Location")).toBe("/confirm-password");
    expect(c.session.get("intended_url")).toBe("http://localhost/settings");
  });

  it("returns 423 for JSON requests", async () => {
    const c = ctx(makeSession(), true);
    const res = await new ConfirmPasswordMiddleware().handle(c as never, (async () => {}) as never);
    expect((res as Response).status).toBe(423);
  });

  it("re-prompts once the confirmation window has elapsed", async () => {
    const stale = Date.now() - 4 * 60 * 60 * 1000; // 4h ago, default window is 3h
    const c = ctx(makeSession({ [PASSWORD_CONFIRMED_AT_KEY]: stale }));
    await new ConfirmPasswordMiddleware().handle(c as never, (async () => {}) as never);
    expect(c.response?.status).toBe(302);
  });
});

// ── Auth password-confirmation helpers (no-boot branches) ────────────────────────

describe("Auth password-confirmation helpers", () => {
  it("markPasswordConfirmed() stamps the session", async () => {
    const session = makeSession();
    await RequestContext.run({ session } as never, async () => {
      Auth.markPasswordConfirmed();
      expect(typeof session.get(PASSWORD_CONFIRMED_AT_KEY)).toBe("number");
    });
  });

  it("hasRecentlyConfirmedPassword() respects the window", async () => {
    await RequestContext.run(
      { session: makeSession({ [PASSWORD_CONFIRMED_AT_KEY]: Date.now() }) } as never,
      async () => {
        expect(Auth.hasRecentlyConfirmedPassword()).toBe(true);
      },
    );
    await RequestContext.run(
      {
        session: makeSession({ [PASSWORD_CONFIRMED_AT_KEY]: Date.now() - 4 * 3600 * 1000 }),
      } as never,
      async () => {
        expect(Auth.hasRecentlyConfirmedPassword()).toBe(false);
      },
    );
  });

  it("confirmPassword() returns false for a guest (no Hash needed)", async () => {
    await RequestContext.run({ session: makeSession() } as never, async () => {
      expect(await Auth.confirmPassword("x")).toBe(false);
    });
  });

  it("logoutOtherDevices() returns false for a guest", async () => {
    await RequestContext.run({ session: makeSession() } as never, async () => {
      expect(await Auth.logoutOtherDevices("x")).toBe(false);
    });
  });
});

// ── AuthenticateSessionMiddleware ────────────────────────────────────────────────

describe("AuthenticateSessionMiddleware", () => {
  const ctx = (user: unknown, session: ReturnType<typeof makeSession>, wantsJson = false) => ({
    user,
    session,
    response: undefined as Response | undefined,
    wantsJson: () => wantsJson,
    redirect(url: string, status = 302) {
      this.response = new Response(null, { status, headers: { Location: url } });
    },
  });

  it("snapshots the password hash on the first authenticated request", async () => {
    const c = ctx({ getAuthPassword: () => "hashA", getAuthId: () => 1 }, makeSession());
    let next = false;
    await new AuthenticateSessionMiddleware().handle(
      c as never,
      (async () => {
        next = true;
      }) as never,
    );
    expect(next).toBe(true);
    expect(c.session.get(AUTH_PASSWORD_HASH_KEY)).toBe("hashA");
  });

  it("passes through when the snapshot still matches", async () => {
    const c = ctx(
      { getAuthPassword: () => "hashA", getAuthId: () => 1 },
      makeSession({ [AUTH_PASSWORD_HASH_KEY]: "hashA" }),
    );
    let next = false;
    await new AuthenticateSessionMiddleware().handle(
      c as never,
      (async () => {
        next = true;
      }) as never,
    );
    expect(next).toBe(true);
  });

  it("tears down the session when the hash changed elsewhere", async () => {
    const c = ctx(
      { getAuthPassword: () => "newHash", getAuthId: () => 1 },
      makeSession({ [AUTH_PASSWORD_HASH_KEY]: "oldHash", user_id: 1 }),
    );
    await new AuthenticateSessionMiddleware().handle(c as never, (async () => {}) as never);
    expect(c.response?.status).toBe(302);
    expect(c.user).toBeUndefined();
    expect(c.session.has("user_id")).toBe(false);
  });

  it("returns 401 for JSON when the session is stale", async () => {
    const c = ctx(
      { getAuthPassword: () => "new", getAuthId: () => 1 },
      makeSession({ [AUTH_PASSWORD_HASH_KEY]: "old" }),
      true,
    );
    const res = await new AuthenticateSessionMiddleware().handle(
      c as never,
      (async () => {}) as never,
    );
    expect((res as Response).status).toBe(401);
  });
});

// ── BasicAuthMiddleware (challenge path) ─────────────────────────────────────────

describe("BasicAuthMiddleware", () => {
  it("returns 401 with a WWW-Authenticate challenge when no credentials are sent", async () => {
    const c = { request: new Request("http://localhost/api") };
    const res = await new BasicAuthMiddleware().handle(c as never, (async () => {}) as never);
    expect((res as Response).status).toBe(401);
    expect((res as Response).headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("returns 401 for a malformed Authorization header", async () => {
    const c = {
      request: new Request("http://localhost/api", { headers: { Authorization: "Bearer x" } }),
    };
    const res = await new BasicAuthMiddleware().handle(c as never, (async () => {}) as never);
    expect((res as Response).status).toBe(401);
  });
});

// ── Compromised-password (HIBP) ──────────────────────────────────────────────────

describe("isPasswordCompromised", () => {
  // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";
  let realFetch: typeof fetch;

  beforeEach(() => {
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns true when the hash suffix appears in the range response", async () => {
    globalThis.fetch = (async () =>
      new Response(
        `00000000000000000000000000000000000:1\r\n${SUFFIX}:42`,
      )) as unknown as typeof fetch;
    expect(await isPasswordCompromised("password")).toBe(true);
  });

  it("respects the threshold", async () => {
    globalThis.fetch = (async () => new Response(`${SUFFIX}:3`)) as unknown as typeof fetch;
    expect(await isPasswordCompromised("password", { threshold: 5 })).toBe(false);
    expect(await isPasswordCompromised("password", { threshold: 2 })).toBe(true);
  });

  it("returns false when the suffix is absent", async () => {
    globalThis.fetch = (async () =>
      new Response(`FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:9`)) as unknown as typeof fetch;
    expect(await isPasswordCompromised("password")).toBe(false);
  });

  it("fails open (false) on a network error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await isPasswordCompromised("password")).toBe(false);
  });
});

// ── EmailOtpBroker ───────────────────────────────────────────────────────────────

describe("EmailOtpBroker", () => {
  function makeBroker(over: Partial<{ expireMinutes: number; maxAttempts: number }> = {}) {
    const store = new Map<string, { code: string; createdAt: Date }>();
    let sent: { email: string; code: string } | null = null;
    const broker = new EmailOtpBroker({
      expireMinutes: over.expireMinutes ?? 10,
      ...(over.maxAttempts !== undefined ? { maxAttempts: over.maxAttempts } : {}),
      findCode: async (email) => store.get(email) ?? null,
      storeCode: async (email, hash) => {
        store.set(email, { code: hash, createdAt: new Date() });
      },
      deleteCode: async (email) => {
        store.delete(email);
      },
      sendCode: async (email, code) => {
        sent = { email, code };
      },
    });
    return {
      broker,
      store,
      get sent() {
        return sent;
      },
    };
  }

  it("send() emails a numeric code and stores only its hash", async () => {
    const ctx = makeBroker();
    await ctx.broker.send("a@b.com");
    expect(ctx.sent?.email).toBe("a@b.com");
    expect(/^\d{6}$/.test(ctx.sent!.code)).toBe(true);
    // stored value is a hash, not the plaintext code
    expect(ctx.store.get("a@b.com")?.code).not.toBe(ctx.sent!.code);
  });

  it("attempt() succeeds once for the right code, then the code is consumed", async () => {
    const ctx = makeBroker();
    await ctx.broker.send("a@b.com");
    const code = ctx.sent!.code;
    expect(await ctx.broker.attempt("a@b.com", code)).toBe(true);
    expect(await ctx.broker.attempt("a@b.com", code)).toBe(false); // already used
  });

  it("attempt() rejects a wrong code and an unknown email", async () => {
    const ctx = makeBroker();
    await ctx.broker.send("a@b.com");
    expect(await ctx.broker.attempt("a@b.com", "000000")).toBe(false);
    expect(await ctx.broker.attempt("none@b.com", "000000")).toBe(false);
  });

  it("attempt() rejects an expired code", async () => {
    const ctx = makeBroker({ expireMinutes: 10 });
    await ctx.broker.send("a@b.com");
    // Backdate the stored record well past the 10-minute window.
    ctx.store.get("a@b.com")!.createdAt = new Date(Date.now() - 11 * 60 * 1000);
    expect(await ctx.broker.attempt("a@b.com", ctx.sent!.code)).toBe(false);
  });

  it("attempt() still accepts the right code after a few typos", async () => {
    const ctx = makeBroker();
    await ctx.broker.send("a@b.com");
    const good = ctx.sent!.code;
    const bad = good === "000000" ? "111111" : "000000";
    expect(await ctx.broker.attempt("a@b.com", bad)).toBe(false);
    expect(await ctx.broker.attempt("a@b.com", bad)).toBe(false);
    expect(await ctx.broker.attempt("a@b.com", good)).toBe(true); // honest retry works
  });

  it("attempt() invalidates the code after 5 wrong guesses (brute-force cap)", async () => {
    const ctx = makeBroker();
    await ctx.broker.send("a@b.com");
    const good = ctx.sent!.code;
    const bad = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      expect(await ctx.broker.attempt("a@b.com", bad)).toBe(false);
    }
    // Code was burned on the 5th failure — even the right code is dead now.
    expect(ctx.store.has("a@b.com")).toBe(false);
    expect(await ctx.broker.attempt("a@b.com", good)).toBe(false);
  });

  it("maxAttempts is configurable", async () => {
    const ctx = makeBroker({ maxAttempts: 2 });
    await ctx.broker.send("a@b.com");
    const good = ctx.sent!.code;
    const bad = good === "000000" ? "111111" : "000000";
    expect(await ctx.broker.attempt("a@b.com", bad)).toBe(false);
    expect(await ctx.broker.attempt("a@b.com", bad)).toBe(false); // hits the limit
    expect(await ctx.broker.attempt("a@b.com", good)).toBe(false); // burned
  });
});

// ── Auth events ─────────────────────────────────────────────────────────────────

describe("Auth events", () => {
  it("PasswordBroker emits PasswordResetLinkSent and PasswordReset", async () => {
    const linkEvents: PasswordResetLinkSent[] = [];
    const resetEvents: PasswordResetEvent[] = [];
    const off1 = FrameworkEvents.on(PasswordResetLinkSent, (e) => linkEvents.push(e));
    const off2 = FrameworkEvents.on(PasswordResetEvent, (e) => resetEvents.push(e));

    const store: Record<string, { token: string; createdAt: Date }> = {};
    let captured = "";
    const broker = new PasswordBroker({
      expireMinutes: 60,
      findToken: async (e) => store[e] ?? null,
      storeToken: async (e, h) => {
        store[e] = { token: h, createdAt: new Date() };
      },
      deleteToken: async (e) => {
        delete store[e];
      },
      pruneTokens: async () => {},
      sendResetLink: async (_e, token) => {
        captured = token;
      },
      resetPassword: async () => {},
    });

    await broker.sendResetLink("a@b.com");
    await broker.reset(captured, "a@b.com", "newpass");

    expect(linkEvents.map((e) => e.email)).toEqual(["a@b.com"]);
    expect(resetEvents.map((e) => e.email)).toEqual(["a@b.com"]);
    off1();
    off2();
  });

  it("markEmailAsVerified() emits EmailVerified", async () => {
    class U extends Model.using(Authenticatable, EmailVerification) {
      override async save(): Promise<this> {
        return this;
      }
    }
    const events: EmailVerified[] = [];
    const off = FrameworkEvents.on(EmailVerified, (e) => events.push(e));

    const u = new U();
    Object.assign(u, { id: 7 });
    await u.markEmailAsVerified();

    expect(events).toHaveLength(1);
    expect(events[0]!.userId).toBe(7);
    off();
  });
});

// ── TwoFactorService.generateCode() ───────────────────────────────────────────

describe("TwoFactorService.generateCode()", () => {
  const tf = new TwoFactorService();

  it("produces a code its own verifier accepts", () => {
    const secret = tf.generateSecret();

    expect(tf.verifyCode(secret, tf.generateCode(secret))).toBe(true);
  });

  it("returns six digits, zero-padded", () => {
    expect(tf.generateCode(tf.generateSecret())).toMatch(/^\d{6}$/);
  });

  it("a different secret yields a different code", () => {
    const a = tf.generateSecret();
    const b = tf.generateSecret();

    // Same time slot, different keys — a collision here would mean the secret
    // is not reaching the HMAC.
    expect(tf.generateCode(a)).not.toBe(tf.generateCode(b));
  });

  it("offsets to an adjacent slot, which the replay guard then rejects", () => {
    const secret = tf.generateSecret();
    const previous = tf.generateCode(secret, -1);

    // Inside the ±window it still verifies…
    const outcome = tf.verifyCodeWithCounter(secret, previous);
    expect(outcome.valid).toBe(true);

    // …but not once a newer counter has been recorded.
    expect(tf.verifyCodeWithCounter(secret, previous, outcome.counter!).valid).toBe(false);
  });

  it("refuses an offset that predates the epoch", () => {
    expect(() => tf.generateCode(tf.generateSecret(), -Number.MAX_SAFE_INTEGER)).toThrow(
      RangeError,
    );
  });
});
