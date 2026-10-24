/**
 * What one test file sets on the shared `TestApp` must not reach the next file.
 *
 * `createTestApp()` hands every file in a process the same `TestApp`, and `withHeaders()`,
 * `withCookie()`, `actingAs()` and `followingRedirects()` set state on it that nothing
 * cleared. The file that failed was whichever ran next, so each passed alone: one app
 * lost seventeen unrelated tests in four files to an `X-Inertia: true` header set in an auth
 * test, and another ran a customer-facing test as a signed-in consultant, so four assertions
 * passed for the wrong reason.
 *
 * Two files are simulated in one process the way `shared-app-adoption.test.ts` does it: the
 * shared app is keyed by the `Application`, so calling `createTestApp()` twice with the same
 * bootstrap is the path a second file takes.
 */
import { describe, it, expect, afterAll } from "bun:test";
import { Application, Router } from "@zerotal/core";
import { createTestApp, type TestApp } from "./TestApp.ts";

let cached: Application | undefined;
function bootstrap(): Application {
  if (!cached) {
    cached = Application.create({ env: "test" }).useConfig({});
    Router.get("/echo", (ctx) => {
      const sent = `${ctx.header("x-leak") ?? "no-header"}|${ctx.header("cookie") ?? "no-cookie"}`;
      return new Response(sent);
    });
    Router.get("/go", () => new Response(null, { status: 302, headers: { Location: "/echo" } }));
    Router.get("/boom", () => {
      throw new Error("boom");
    });
  }
  return cached;
}

let fileA: TestApp;
let fileB: TestApp;

afterAll(async () => {
  await fileB?.close();
  Application._resetInstance();
  cached = undefined;
});

describe("two test files in one `bun test` process", () => {
  it("file A sets state for its own requests", async () => {
    fileA = await createTestApp(bootstrap);
    fileA.withHeaders({ "X-Leak": "from-file-a" });
    fileA.withCookie("theme", "dark");
    fileA.followingRedirects();
    fileA.withoutExceptionHandling();

    expect(await (await fileA.get("/echo")).text()).toBe("from-file-a|theme=dark");
    expect((await fileA.get("/go")).status).toBe(200);
    expect((await fileA.get("/boom")).headers.get("X-Zerotal-Test-Exception")).toBe("1");

    // The acting user is encoded into a cookie by the app's session driver on the next request.
    // This app has none, so a user left over from here makes file B's first request throw.
    fileA.actingAs({ id: 7 });
    await fileA.close(); // what file A's afterAll does
  });

  it("file B starts with no header of file A's", async () => {
    fileB = await createTestApp(bootstrap); // what file B's beforeAll does

    expect(await (await fileB.get("/echo")).text()).toBe("no-header|no-cookie");
  });

  it("file B starts with no cookie, no redirect following and normal exception handling", async () => {
    expect((await fileB.get("/go")).status).toBe(302);
    expect((await fileB.get("/boom")).headers.get("X-Zerotal-Test-Exception")).toBeNull();
  });
});

describe("a file that never calls close()", () => {
  it("does not hand its state to the file that runs after it", async () => {
    const never = await createTestApp(bootstrap);
    never.withHeaders({ "X-Leak": "never-closed" });
    never.withCookie("session_hint", "abc");
    never.actingAs({ id: 9 });

    const next = await createTestApp(bootstrap);

    expect(next).toBe(never);
    expect(await (await next.get("/echo")).text()).toBe("no-header|no-cookie");
  });

  it("still keeps state across the tests of one file, which is how a file configures its client", async () => {
    const app = await createTestApp(bootstrap);
    app.withHeaders({ "X-Leak": "set-in-beforeAll" });

    expect(await (await app.get("/echo")).text()).toBe("set-in-beforeAll|no-cookie");
    expect(await (await app.get("/echo")).text()).toBe("set-in-beforeAll|no-cookie");
  });
});
