import { describe, it, expect, afterEach } from "bun:test";
import { Health, resolveHealthConfig, checkHealthAccess } from "./Health.ts";

const meta = { name: "app", version: "1.0.0", environment: "test", uptime: 5 };
afterEach(() => Health.clear());

describe("Health registry", () => {
  it("reports ok with metadata when all checks pass", async () => {
    Health.register("a", () => {});
    Health.register("b", () => ({ status: "ok", meta: { x: 1 } }));
    const r = await Health.run(meta);
    expect(r.status).toBe("ok");
    expect(r.app).toEqual({ name: "app", version: "1.0.0", environment: "test" });
    expect(r.uptime).toBe(5);
    expect(r.checks.a!.status).toBe("ok");
    expect(r.checks.b!.meta).toEqual({ x: 1 });
    expect(typeof r.checks.a!.durationMs).toBe("number");
  });

  it("a thrown check becomes down with the error message", async () => {
    Health.register(
      "boom",
      () => {
        throw new Error("no db");
      },
      { critical: true },
    );
    const r = await Health.run(meta);
    expect(r.checks.boom!.status).toBe("down");
    expect(r.checks.boom!.message).toBe("no db");
  });

  it("critical failure → overall down; non-critical failure → degraded", async () => {
    Health.register("cache", () => ({ status: "down" })); // non-critical
    expect((await Health.run(meta)).status).toBe("degraded");
    Health.register("db", () => ({ status: "down" }), { critical: true });
    expect((await Health.run(meta)).status).toBe("down");
  });

  it("register/remove/has/names manage the set", () => {
    Health.register("x", () => {});
    expect(Health.has("x")).toBe(true);
    expect(Health.names).toContain("x");
    Health.remove("x");
    expect(Health.has("x")).toBe(false);
  });
});

describe("resolveHealthConfig", () => {
  it("defaults: on outside production, off in production", () => {
    expect(resolveHealthConfig(undefined, false).enabled).toBe(true);
    expect(resolveHealthConfig(undefined, true).enabled).toBe(false);
  });
  it("explicit enabled and legacy app.health win", () => {
    expect(resolveHealthConfig({ enabled: true }, true).enabled).toBe(true);
    expect(resolveHealthConfig(undefined, true, true).enabled).toBe(true);
  });
  it("defaults path and showDetails", () => {
    const c = resolveHealthConfig({ secret: "s" }, true);
    expect(c.path).toBe("/health");
    expect(c.showDetails).toBe(true);
    expect(c.secret).toBe("s");
  });
});

describe("checkHealthAccess", () => {
  const cfg = (over = {}) => resolveHealthConfig({ ...over }, true);
  const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

  it("enforces a configured secret via ?key= or header", () => {
    const c = cfg({ secret: "s3cret" });
    expect(checkHealthAccess(req("https://x/health?key=s3cret"), c, true).allowed).toBe(true);
    expect(
      checkHealthAccess(req("https://x/health", { "x-health-key": "s3cret" }), c, true).allowed,
    ).toBe(true);
    const bad = checkHealthAccess(req("https://x/health?key=nope"), c, true);
    expect(bad.allowed).toBe(false);
    expect(bad.code).toBe(401);
  });
  it("refuses in production when no secret is set", () => {
    const r = checkHealthAccess(req("https://x/health"), cfg(), true);
    expect(r.allowed).toBe(false);
    expect(r.code).toBe(503);
  });
  it("is open in development without a secret", () => {
    expect(
      checkHealthAccess(req("https://x/health"), resolveHealthConfig(undefined, false), false)
        .allowed,
    ).toBe(true);
  });
});
