import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Container, Router } from "@zerotal/core";
import { registerRunMigrationsEndpoint, _resetDiagnosisTokens } from "./runMigrationsEndpoint.ts";

/**
 * The error page's one-click migration fix is same-origin to the error page, so a page that
 * pointed its own name at 127.0.0.1 could read the token and post it. It answers this machine
 * only, by the debug panel's rule.
 */
const priorEnv = Bun.env["APP_ENV"];

async function post(url: string): Promise<Response> {
  const table = Router.compile(new Container(), []) as Record<
    string,
    Record<string, (req: Request) => Response | Promise<Response>>
  >;
  const handler = table["/__zerotal/run-migrations"]?.["POST"];
  if (!handler) throw new Error("endpoint not registered");
  return handler(new Request(url, { method: "POST" }));
}

describe("the one-click migration fix", () => {
  beforeEach(() => {
    Bun.env["APP_ENV"] = "development";
    Router.reset();
    _resetDiagnosisTokens();
    registerRunMigrationsEndpoint(() => []);
  });
  afterEach(() => {
    Router.reset();
    if (priorEnv === undefined) delete Bun.env["APP_ENV"];
    else Bun.env["APP_ENV"] = priorEnv;
  });

  it("refuses a request addressed to a foreign name", async () => {
    expect((await post("http://evil.example:3000/__zerotal/run-migrations")).status).toBe(404);
  });

  it("goes on to its token check for this machine", async () => {
    // No token was sent, so the next guard refuses it: the host check let it through.
    expect((await post("http://localhost:3000/__zerotal/run-migrations")).status).toBe(403);
  });
});
