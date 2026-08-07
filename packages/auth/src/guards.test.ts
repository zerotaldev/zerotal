import { describe, it, expect } from "bun:test";
import { RequestContext } from "@zerotal/core";
import { Jwt } from "./Jwt.ts";
import { JwtGuardMiddleware } from "./JwtGuardMiddleware.ts";
import { Auth } from "./facades/Auth.ts";

// ── JWT ───────────────────────────────────────────────────────────────────────

describe("Jwt", () => {
  const secret = "test-secret";

  it("sign() → verify() round-trips claims and adds iat", () => {
    const token = Jwt.sign({ sub: 7, role: "admin" }, secret);
    const claims = Jwt.verify<{ sub: number; role: string; iat: number }>(token, secret);
    expect(claims?.sub).toBe(7);
    expect(claims?.role).toBe("admin");
    expect(typeof claims?.iat).toBe("number");
  });

  it("verify() rejects a wrong secret", () => {
    const token = Jwt.sign({ sub: 1 }, secret);
    expect(Jwt.verify(token, "other-secret")).toBeNull();
  });

  it("verify() rejects a tampered payload", () => {
    const token = Jwt.sign({ sub: 1 }, secret);
    const [h, , s] = token.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 999 })).toString("base64url")}.${s}`;
    expect(Jwt.verify(forged, secret)).toBeNull();
  });

  it("verify() rejects malformed tokens", () => {
    expect(Jwt.verify("not-a-jwt", secret)).toBeNull();
    expect(Jwt.verify("a.b", secret)).toBeNull();
  });

  it("verify() rejects a non-HS256 alg (e.g. alg:none)", () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    // A well-formed "alg: none" token with an empty signature must be rejected.
    const noneToken = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: 1 })}.`;
    expect(Jwt.verify(noneToken, secret)).toBeNull();
    // A token whose header claims a different alg but reuses a valid HS256 body/sig.
    const real = Jwt.sign({ sub: 1 }, secret);
    const [, body, sig] = real.split(".");
    const swapped = `${b64({ alg: "HS512", typ: "JWT" })}.${body}.${sig}`;
    expect(Jwt.verify(swapped, secret)).toBeNull();
  });

  it("honours expiresIn — expired tokens fail verification", () => {
    const past = Math.floor(Date.now() / 1000) - 100;
    const token = Jwt.sign({ sub: 1 }, secret, { expiresIn: 10, issuedAt: past });
    expect(Jwt.verify(token, secret)).toBeNull();
  });

  it("non-expired tokens verify", () => {
    const token = Jwt.sign({ sub: 1 }, secret, { expiresIn: 3600 });
    expect(Jwt.verify(token, secret)?.sub).toBe(1);
  });
});

// ── JwtGuardMiddleware ─────────────────────────────────────────────────────────

describe("JwtGuardMiddleware", () => {
  const secret = "mw-secret";
  const ctx = (auth?: string) => ({
    user: undefined as unknown,
    request: new Request("http://localhost/api", auth ? { headers: { Authorization: auth } } : {}),
  });

  it("populates ctx.user from a valid bearer JWT", async () => {
    const token = Jwt.sign({ sub: 42 }, secret);
    const c = ctx(`Bearer ${token}`);
    const mw = JwtGuardMiddleware.with({
      secret,
      resolve: (claims) => ({ id: claims["sub"] }),
    });
    await new mw().handle(c as never, (async () => {}) as never);
    expect((c.user as { id: number }).id).toBe(42);
  });

  it("leaves ctx.user undefined for an invalid token", async () => {
    const c = ctx("Bearer garbage");
    const mw = JwtGuardMiddleware.with({ secret, resolve: () => ({ id: 1 }) });
    await new mw().handle(c as never, (async () => {}) as never);
    expect(c.user).toBeUndefined();
  });

  it("leaves ctx.user undefined when no Authorization header", async () => {
    const c = ctx();
    const mw = JwtGuardMiddleware.with({ secret, resolve: () => ({ id: 1 }) });
    await new mw().handle(c as never, (async () => {}) as never);
    expect(c.user).toBeUndefined();
  });
});

// ── Multiple guards ─────────────────────────────────────────────────────────────

describe("Auth.guard / Auth.viaRequest", () => {
  it("a request guard resolves the user from the request and caches it", async () => {
    let calls = 0;
    Auth.viaRequest("api-test", (req) => {
      calls++;
      return req.headers.get("x-user") ? { id: 99 } : null;
    });

    const ctx = { request: new Request("http://localhost/", { headers: { "x-user": "1" } }) };
    await RequestContext.run(ctx as never, async () => {
      const g = Auth.guard("api-test");
      expect((await g.userOrNull()) as { id: number }).toEqual({ id: 99 });
      expect(await g.check()).toBe(true);
      expect(await g.id()).toBe(99);
      await g.userOrNull(); // cached — resolver not called again
      expect(calls).toBe(1);
    });
  });

  it("a request guard reports guest when the resolver returns null", async () => {
    Auth.viaRequest("api-empty", () => null);
    const ctx = { request: new Request("http://localhost/") };
    await RequestContext.run(ctx as never, async () => {
      const g = Auth.guard("api-empty");
      expect(await g.userOrNull()).toBeUndefined();
      expect(await g.guest()).toBe(true);
      await expect(g.user()).rejects.toThrow();
    });
  });

  it("throws for an unregistered guard name", () => {
    expect(() => Auth.guard("nope")).toThrow(/not defined/);
  });

  it("the default guard mirrors the top-level Auth identity", async () => {
    const ctx = { user: { getAuthId: () => 5 } };
    await RequestContext.run(ctx as never, async () => {
      const web = Auth.guard();
      expect(await web.check()).toBe(true);
      expect(await web.id()).toBe(5);
    });
    await RequestContext.run({} as never, async () => {
      expect(await Auth.guard("web").guest()).toBe(true);
    });
  });
});
