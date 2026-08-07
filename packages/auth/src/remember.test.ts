import { describe, it, expect } from "bun:test";
import { RequestContext } from "@zerotal/core";
import {
  REMEMBER_COOKIE,
  mintRememberToken,
  hashRememberToken,
  rememberTokenMatches,
  encodeRememberValue,
  parseRememberValue,
  buildRememberCookie,
  forgetRememberCookie,
} from "./RememberMe.ts";
import { RememberMeMiddleware } from "./RememberMeMiddleware.ts";
import { Auth } from "./facades/Auth.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  };
}

// ── RememberMe helpers ──────────────────────────────────────────────────────────

describe("RememberMe helpers", () => {
  it("mintRememberToken() returns a 60-char hex string, unique each call", () => {
    const a = mintRememberToken();
    const b = mintRememberToken();
    expect(a).toMatch(/^[0-9a-f]{60}$/);
    expect(a).not.toBe(b);
  });

  it("hashRememberToken() is a stable 64-char sha256 hex", () => {
    expect(hashRememberToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRememberToken("abc")).toBe(hashRememberToken("abc"));
  });

  it("rememberTokenMatches() is true only for the raw token behind the hash", () => {
    const raw = mintRememberToken();
    const stored = hashRememberToken(raw);
    expect(rememberTokenMatches(raw, stored)).toBe(true);
    expect(rememberTokenMatches("wrong", stored)).toBe(false);
  });

  it("encode/parse round-trips id and token (token may contain nothing odd)", () => {
    expect(parseRememberValue(encodeRememberValue(42, "tok"))).toEqual({ id: "42", token: "tok" });
    expect(parseRememberValue("no-separator")).toBeNull();
    expect(parseRememberValue("7|")).toBeNull();
  });

  it("buildRememberCookie() / forgetRememberCookie() produce expected attributes", () => {
    const set = buildRememberCookie("7|tok", { maxAge: 123 });
    expect(set.startsWith(`${REMEMBER_COOKIE}=7|tok`)).toBe(true);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Path=/");
    expect(set).toContain("Max-Age=123");
    // Secure by default — this is a long-lived, password-free credential, and the internal
    // URL behind a TLS-terminating proxy is plain http:, so it cannot be sniffed.
    expect(set).toContain("Secure");
    expect(buildRememberCookie("v", { secure: false })).not.toContain("Secure");

    const forget = forgetRememberCookie();
    expect(forget).toContain(`${REMEMBER_COOKIE}=`);
    expect(forget).toContain("Max-Age=0");
    expect(forget).toContain("Secure");
  });
});

// ── RememberMeMiddleware — read (re-auth from cookie) ────────────────────────────

describe("RememberMeMiddleware (read path)", () => {
  const makeCtx = (opts: {
    cookie?: string;
    user?: unknown;
    loader?: (id: number) => Promise<unknown>;
  }) => {
    const headers: Record<string, string> = {};
    if (opts.cookie) headers["Cookie"] = opts.cookie;
    const session = makeSession();
    return {
      user: opts.user,
      session,
      response: undefined as Response | undefined,
      request: new Request("http://localhost/dashboard", { headers }),
      container: {
        container: {
          tryMake: (k: string) => (k === "auth.userLoader" ? opts.loader : undefined),
        },
      },
    };
  };

  it("re-authenticates from a valid remember cookie and re-seeds the session", async () => {
    const raw = mintRememberToken();
    const user = { id: 1, getAuthId: () => 1, getRememberToken: () => hashRememberToken(raw) };
    const ctx = makeCtx({
      cookie: `${REMEMBER_COOKIE}=${encodeRememberValue(1, raw)}`,
      loader: async (id) => (id === 1 ? user : null),
    });

    await new RememberMeMiddleware().handle(ctx as never, (async () => {}) as never);

    expect(ctx.user).toBe(user);
    expect(ctx.session.get("user_id")).toBe(1);
    expect((ctx as { _viaRemember?: boolean })._viaRemember).toBe(true);
  });

  it("ignores a cookie whose token does not match the stored hash", async () => {
    const user = { id: 1, getAuthId: () => 1, getRememberToken: () => hashRememberToken("real") };
    const ctx = makeCtx({
      cookie: `${REMEMBER_COOKIE}=${encodeRememberValue(1, "forged")}`,
      loader: async () => user,
    });

    await new RememberMeMiddleware().handle(ctx as never, (async () => {}) as never);

    expect(ctx.user).toBeUndefined();
    expect(ctx.session.has("user_id")).toBe(false);
  });

  it("does nothing when a user is already authenticated (session took precedence)", async () => {
    const existing = { id: 9 };
    let loaderCalled = false;
    const ctx = makeCtx({
      user: existing,
      cookie: `${REMEMBER_COOKIE}=${encodeRememberValue(1, mintRememberToken())}`,
      loader: async () => {
        loaderCalled = true;
        return null;
      },
    });

    await new RememberMeMiddleware().handle(ctx as never, (async () => {}) as never);

    expect(ctx.user).toBe(existing);
    expect(loaderCalled).toBe(false);
  });

  it("is a no-op when there is no remember cookie", async () => {
    const ctx = makeCtx({ loader: async () => ({ id: 1 }) });
    await new RememberMeMiddleware().handle(ctx as never, (async () => {}) as never);
    expect(ctx.user).toBeUndefined();
  });
});

// ── RememberMeMiddleware — write (flush queued cookie) ───────────────────────────

describe("RememberMeMiddleware (write path)", () => {
  const flushCtx = (action: unknown) => ({
    user: { id: 1 },
    session: makeSession(),
    response: new Response("ok"),
    request: new Request("http://localhost/login"),
    container: { container: { tryMake: () => undefined } },
    _rememberMe: action,
  });

  it("writes the remember cookie when a 'set' action is queued", async () => {
    const ctx = flushCtx({ type: "set", value: "1|abc" });
    await new RememberMeMiddleware().handle(ctx as never, (async () => ctx.response) as never);
    const setCookie = ctx.response.headers.get("Set-Cookie")!;
    expect(setCookie).toContain(`${REMEMBER_COOKIE}=1|abc`);
    expect(setCookie).toContain("HttpOnly");
  });

  it("clears the remember cookie when a 'clear' action is queued", async () => {
    const ctx = flushCtx({ type: "clear" });
    await new RememberMeMiddleware().handle(ctx as never, (async () => ctx.response) as never);
    const setCookie = ctx.response.headers.get("Set-Cookie")!;
    expect(setCookie).toContain(`${REMEMBER_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=0");
  });
});

// ── Auth facade integration ─────────────────────────────────────────────────────

describe("Auth remember-me integration", () => {
  it("login({ remember: true }) persists a token hash and queues the cookie", async () => {
    let saved = false;
    const user = {
      rememberToken: null as string | null,
      getAuthId: () => 7,
      setRememberToken(v: string | null) {
        this.rememberToken = v;
      },
      async save() {
        saved = true;
      },
    };
    const session = makeSession();

    await RequestContext.run({ session, user: undefined } as never, async () => {
      await Auth.login(user as never, { remember: true });
      const ctx = RequestContext.get() as unknown as {
        _rememberMe?: { type: string; value: string };
      };
      expect(ctx._rememberMe?.type).toBe("set");
      expect(ctx._rememberMe?.value.startsWith("7|")).toBe(true);
      // The cookie carries the RAW token; the DB stores its hash.
      const rawToken = ctx._rememberMe!.value.split("|")[1]!;
      expect(rememberTokenMatches(rawToken, user.rememberToken!)).toBe(true);
    });

    expect(saved).toBe(true);
    expect(session.get("user_id")).toBe(7);
  });

  it("login without remember does not queue a cookie", async () => {
    const user = { getAuthId: () => 7, setRememberToken() {}, async save() {} };
    const session = makeSession();
    await RequestContext.run({ session, user: undefined } as never, async () => {
      await Auth.login(user as never);
      const ctx = RequestContext.get() as unknown as { _rememberMe?: unknown };
      expect(ctx._rememberMe).toBeUndefined();
    });
  });

  it("logout() clears the stored token and queues cookie deletion", async () => {
    const user = {
      rememberToken: "some-hash" as string | null,
      getAuthId: () => 7,
      setRememberToken(v: string | null) {
        this.rememberToken = v;
      },
      async save() {},
    };
    const session = makeSession({ user_id: 7 });

    await RequestContext.run({ session, user } as never, async () => {
      await Auth.logout();
      const ctx = RequestContext.get() as unknown as { _rememberMe?: { type: string } };
      expect(ctx._rememberMe?.type).toBe("clear");
    });

    expect(user.rememberToken).toBeNull();
    expect(session.has("user_id")).toBe(false);
  });

  it("viaRemember() reflects the flag set by the middleware", async () => {
    await RequestContext.run({ _viaRemember: true } as never, async () => {
      expect(Auth.viaRemember()).toBe(true);
    });
    await RequestContext.run({} as never, async () => {
      expect(Auth.viaRemember()).toBe(false);
    });
  });
});
