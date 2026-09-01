/**
 * The gate, tested on the things that go wrong quietly.
 *
 * Almost none of these fail loudly if you get them wrong: a maintenance page at
 * 200 looks identical to one at 503 in a browser, a token in the address bar
 * looks like a working link, and a webhook returning 503 looks like the provider
 * being slow. Each one is cheap to assert and expensive to find.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { GateMiddleware, GATE_COOKIE, GATE_QUERY } from "./GateMiddleware.ts";
import { readGate, writeGate, clearGate, gateExpired, hashToken, GATE_FILE } from "./state.ts";
import { Gate } from "./Gate.ts";

const TOKEN = "preview-token-long-enough";

let root: string;
let cwd: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zt-gate-"));
  cwd = process.cwd();
  process.chdir(root);
  Bun.env["APP_KEY"] = "test-key-for-gate-signing";
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
});

/** Run the gate against a request and return what it answered, or `null` for "passed through". */
async function through(
  url: string,
  init: RequestInit = {},
): Promise<{ response: Response | null; passed: boolean }> {
  const ctx = HttpContext.fake(url, init);
  let passed = false;
  const result = await new GateMiddleware().handle(ctx, async () => {
    passed = true;
  });
  return { response: (result as Response | undefined) ?? null, passed };
}

describe("an open site", () => {
  it("passes every request through", async () => {
    const { passed } = await through("http://localhost/anything");
    expect(passed).toBe(true);
  });

  it("reads a corrupt state file as open, not as down", async () => {
    // Failing closed would take a site down because a JSON file lost a brace.
    // "The site is up" is the safer error for a mechanism whose purpose is to be
    // turned off again.
    mkdirSync(join(root, "storage", "framework"), { recursive: true });
    writeFileSync(join(root, GATE_FILE), "{ not json", "utf8");

    expect(readGate()).toBeNull();
    expect((await through("http://localhost/")).passed).toBe(true);
  });
});

describe("maintenance", () => {
  beforeEach(async () => {
    await Gate.maintenance({ retryAfter: 120, by: "Sipho" });
  });

  it("answers 503 with Retry-After, never 200", async () => {
    // A maintenance page at 200 tells a crawler the apology is the homepage, and
    // it indexes it. Sites have lost rankings to a two-hour window.
    const { response } = await through("http://localhost/");
    expect(response?.status).toBe(503);
    expect(response?.headers.get("Retry-After")).toBe("120");
  });

  it("is never cached", async () => {
    const { response } = await through("http://localhost/");
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
  });

  it("refuses staff too — the database may be what is down", async () => {
    const ctx = HttpContext.fake("http://localhost/admin");
    (ctx as unknown as { user: unknown }).user = { role: "admin" };
    const result = await new GateMiddleware().handle(ctx, async () => {});
    expect((result as Response).status).toBe(503);
  });

  it("leaves the health endpoint open", async () => {
    // Otherwise the uptime monitor pages the on-call about a planned window, and
    // a deploy gate that polls health fails its own release.
    expect((await through("http://localhost/__zerotal/health")).passed).toBe(true);
  });

  it("leaves static assets open, so the apology is not unstyled", async () => {
    expect((await through("http://localhost/css/app.css")).passed).toBe(true);
    expect((await through("http://localhost/favicon.ico")).passed).toBe(true);
  });
});

describe("private preview", () => {
  beforeEach(async () => {
    await Gate.preview({ token: TOKEN, by: "Sipho" });
  });

  it("shows the public a holding page at 200 by default", async () => {
    const { response } = await through("http://localhost/");
    expect(response?.status).toBe(200);
    expect(await response!.text()).toContain("not open to the public");
  });

  it("admits a correct token and strips it from the URL", async () => {
    // A token left in the address bar travels into Referer on every outbound
    // link, into analytics, and into screenshots. Strip it on first use.
    const { response } = await through(`http://localhost/tours?${GATE_QUERY}=${TOKEN}&page=2`);

    expect(response?.status).toBe(302);
    const location = response!.headers.get("Location")!;
    expect(location).not.toContain(GATE_QUERY);
    expect(location).toBe("/tours?page=2");
    expect(response!.headers.get("Set-Cookie")).toContain(GATE_COOKIE);
  });

  it("issues a cookie that is HttpOnly, SameSite=Lax and expiring", async () => {
    const { response } = await through(`http://localhost/?${GATE_QUERY}=${TOKEN}`);
    const cookie = response!.headers.get("Set-Cookie")!;

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    // Days, not months: an ex-tester should not keep access to a site that has
    // since gone live with real customer data.
    expect(cookie).toContain("Max-Age=604800");
  });

  it("does not put the token in the cookie", async () => {
    const { response } = await through(`http://localhost/?${GATE_QUERY}=${TOKEN}`);
    expect(response!.headers.get("Set-Cookie")).not.toContain(TOKEN);
  });

  it("admits a visitor holding the issued cookie", async () => {
    const { response } = await through(`http://localhost/?${GATE_QUERY}=${TOKEN}`);
    const cookie = response!.headers.get("Set-Cookie")!.split(";")[0]!;

    const second = await through("http://localhost/tours", { headers: { cookie } });
    expect(second.passed).toBe(true);
  });

  it("refuses a wrong token", async () => {
    const { response, passed } = await through(`http://localhost/?${GATE_QUERY}=wrong-token-here`);
    expect(passed).toBe(false);
    expect(response?.status).toBe(200);
    expect(await response!.text()).toContain("not open");
  });

  it("refuses a forged cookie", async () => {
    const forged = await through("http://localhost/", {
      headers: { cookie: `${GATE_COOKIE}=not-a-real-signature` },
    });
    expect(forged.passed).toBe(false);
  });

  it("invalidates existing cookies when the token is rotated", async () => {
    // The way a preview leaks is a tester forwarding the link to somebody who
    // has left, so rotation has to actually revoke.
    const { response } = await through(`http://localhost/?${GATE_QUERY}=${TOKEN}`);
    const cookie = response!.headers.get("Set-Cookie")!.split(";")[0]!;

    await Gate.preview({ token: "a-completely-different-token" });

    expect((await through("http://localhost/", { headers: { cookie } })).passed).toBe(false);
  });

  /** Run the gate with `user` attached, as the auth package would. */
  async function asUser(role: unknown): Promise<boolean> {
    const ctx = HttpContext.fake("http://localhost/");
    (ctx as unknown as { user: unknown }).user = { role };
    let passed = false;
    await new GateMiddleware().handle(ctx, async () => {
      passed = true;
    });
    return passed;
  }

  it("admits an admin without a token", async () => {
    expect(await asUser("admin")).toBe(true);
  });

  it("refuses every role that is not on the allowlist", async () => {
    // 1.13.3 asked `role !== "customer"`, which reads as "everyone except
    // customers is staff" — so in an app whose roles are `user` and `admin`,
    // every signed-in visitor walked through the gate and the public saw the
    // site. A gate that fails *open* is worse than no gate, because it reports
    // success while doing nothing.
    for (const role of ["user", "customer", "editor", "guest", "", "ADMIN"]) {
      expect(await asUser(role)).toBe(false);
    }
  });

  it("refuses a user whose role is not a string", async () => {
    for (const role of [undefined, null, 42, { name: "admin" }, ["admin"]]) {
      expect(await asUser(role)).toBe(false);
    }
  });

  it("lifts itself once `until` has passed", async () => {
    // A pre-launch gate outlives its purpose more often than it is taken down.
    writeGate({
      mode: "preview",
      since: "2026-01-01T00:00:00.000Z",
      until: "2026-01-02",
      tokenHash: hashToken(TOKEN),
    });
    expect((await through("http://localhost/")).passed).toBe(true);
  });
});

describe("Gate.status()", () => {
  it("reports an open site", () => {
    expect(Gate.status()).toEqual({ mode: "open" });
  });

  it("reports who and when, and never the token", async () => {
    await Gate.preview({ token: TOKEN, until: "2099-01-01", by: "Sipho" });
    const status = Gate.status();

    expect(status.mode).toBe("preview");
    expect(status.by).toBe("Sipho");
    expect(status.expired).toBe(false);
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  it("flags a preview whose window has closed", async () => {
    writeGate({ mode: "preview", since: "2026-01-01T00:00:00.000Z", until: "2026-01-02" });
    expect(Gate.status().expired).toBe(true);
  });
});

describe("the state file", () => {
  it("stores the token as a hash, never the token", async () => {
    await Gate.preview({ token: TOKEN });
    const raw = await Bun.file(join(root, GATE_FILE)).text();

    // The file is readable by anything on the box and copied by every backup.
    expect(raw).not.toContain(TOKEN);
    expect(raw).toContain(hashToken(TOKEN));
  });

  it("refuses a token short enough to guess", async () => {
    await expect(Gate.preview({ token: "short" })).rejects.toThrow("at least 16 characters");
  });

  it("survives being opened twice", async () => {
    await Gate.open();
    await Gate.open();
    expect(Gate.status().mode).toBe("open");
  });

  it("treats `until` as through the end of that day", () => {
    const state = { mode: "preview" as const, since: "x", until: "2026-06-15" };
    expect(gateExpired(state, new Date("2026-06-15T22:00:00.000Z"))).toBe(false);
    expect(gateExpired(state, new Date("2026-06-16T00:00:01.000Z"))).toBe(true);
  });
});

describe("declared allow-list", () => {
  it("is the only way a webhook stays reachable", async () => {
    // The item on the list that costs money: a payment provider posting a
    // settlement into a maintenance window gets a 503, and depending on the
    // provider that is a retry, a dropped callback, or a payment the books never
    // learn about. Nothing can infer which routes a third party calls.
    await Gate.maintenance();
    expect((await through("http://localhost/webhooks/paystack")).passed).toBe(false);

    clearGate();
    expect(readGate()).toBeNull();
  });
});
