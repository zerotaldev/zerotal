import { describe, it, expect } from "bun:test";
import {
  Container,
  HttpContext,
  RequestContext,
  ScopedResolver,
  withApp,
  type Application,
} from "@zerotal/core";
import { Auditor } from "./Auditor.ts";
import type { AuditDriver } from "./drivers/AuditDriver.ts";
import type { AuditPayload, AuditRecord } from "./types.ts";

/**
 * The address in the audit trail is the one thing in it the person the entry is about can
 * influence, so it has to come from where they cannot: the socket, or a forwarded header read
 * from the right when the app has said how many proxies it has. It used to be the leftmost
 * `X-Forwarded-For` entry, which is whatever the client typed.
 */
class Recorder implements AuditDriver {
  records: AuditPayload[] = [];
  async record(payload: AuditPayload): Promise<void> {
    this.records.push(payload);
  }
  async forModel(): Promise<AuditRecord[]> {
    return [];
  }
}

function requestFrom(headers: Record<string, string>, socket?: string): HttpContext {
  const ctx = new HttpContext(
    new Request("http://localhost/orders", { headers }),
    new ScopedResolver(new Container()),
  );
  if (socket) {
    ctx._server = { requestIP: () => ({ address: socket, family: "IPv4", port: 0 }) };
  }
  return ctx;
}

async function recordedAddress(ctx: HttpContext): Promise<string | null | undefined> {
  const driver = new Recorder();
  const auditor = new Auditor(driver, {
    driver: "database",
    table: "audit_logs",
    pruneKeep: 0,
    captureRequest: true,
  });
  await RequestContext.run(ctx, () => auditor.log("order.viewed", { auditable_type: "Order" }));
  return driver.records[0]?.ip_address;
}

/** An app whose `app.throttle` config is `throttle`, just enough for `config.safe()` to read. */
function appWithThrottle(throttle: unknown): Application {
  const manager = {
    get: (path: string, fallback?: unknown) => (path === "app.throttle" ? throttle : fallback),
  };
  return { container: { makeSync: () => manager } } as unknown as Application;
}

describe("the address the audit trail records", () => {
  it("is the socket address, whatever X-Forwarded-For says", async () => {
    const ctx = requestFrom({ "x-forwarded-for": "6.6.6.6" }, "203.0.113.9");

    expect(await recordedAddress(ctx)).toBe("203.0.113.9");
  });

  it("cannot be chosen by the person the entry is about", async () => {
    const seen = new Set<string | null | undefined>();
    for (const typed of ["1.1.1.1", "2.2.2.2", "the-cfo", "9.9.9.9, 8.8.8.8"]) {
      seen.add(await recordedAddress(requestFrom({ "x-forwarded-for": typed }, "203.0.113.9")));
    }

    expect([...seen]).toEqual(["203.0.113.9"]);
  });

  it("reads the client from the right of the header when the app has a proxy", async () => {
    const app = appWithThrottle({ maxAttempts: 60, windowSeconds: 60, trustedProxies: 1 });
    const ctx = requestFrom({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }, "10.0.0.1");

    expect(await withApp(app, () => recordedAddress(ctx))).toBe("203.0.113.9");
  });

  it("is null when the request offers no address at all", async () => {
    expect(await recordedAddress(requestFrom({}))).toBeNull();
  });
});
