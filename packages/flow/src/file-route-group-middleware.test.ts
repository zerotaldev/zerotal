/**
 * A Flow page reached through file routing runs its group's middleware once.
 *
 * The page resolver registers at the absolute path through `Router._registerAbsolute`,
 * which puts the enclosing group's middleware in front of the route's own. The file
 * scanner used to hand the resolver a list that already began with the group's
 * middleware, so a Flow page under `fileBasedRouting({ ..., middleware })` ran each of
 * them twice per request.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { Application, Router } from "@zerotal/core";
import type { HttpContext, NextFn } from "@zerotal/core";
import { FlowProvider } from "./provider/FlowProvider.ts";
import { DirCount } from "./__fixtures__/group-routes/inv/_middleware.ts";

class GroupCount {
  static calls = 0;

  async handle(_http: HttpContext, next: NextFn): Promise<Response | void> {
    GroupCount.calls++;
    return next();
  }
}

const dir = fileURLToPath(new URL("./__fixtures__/group-routes", import.meta.url));

let app: Application;
let base: string;

beforeAll(async () => {
  Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  Application._resetInstance();
  Router.reset();
  app = Application.create({ env: "test", providers: [FlowProvider] });
  app.fileBasedRouting({ pages: { dir, prefix: "/g", middleware: [GroupCount as never] } });
  await app.boot();
  await app.start(0);
  const server = (app as unknown as { _static?: { port: number } })._static;
  base = `http://localhost:${server?.port}`;
});

afterAll(async () => {
  // `close()`, not `stop()`: the latter exits the process before the summary prints.
  await app?.close?.();
  Router.reset();
});

describe("a Flow file page under a middleware group", () => {
  it("lists the group's middleware once", () => {
    const names = Router.middlewareFor("GET", "/g/inv").map((m) => m.name);
    expect(names).toEqual(["GroupCount", "DirCount"]);
  });

  it("runs the group's and the directory's middleware once per request", async () => {
    GroupCount.calls = 0;
    DirCount.calls = 0;
    const res = await fetch(`${base}/g/inv`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("invoices");
    expect({ group: GroupCount.calls, dir: DirCount.calls }).toEqual({ group: 1, dir: 1 });
  });
});
