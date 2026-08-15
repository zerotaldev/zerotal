import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Container, Router } from "@zerotal/core";
import { registerDevtoolsApi } from "./api.ts";
import { clearEntries, putEntry } from "./store.ts";
import { DEVTOOLS_API_PREFIX } from "./types.ts";
import type { DevtoolsEntry } from "./types.ts";

const priorEnv = Bun.env["APP_ENV"];

/**
 * Invoke an endpoint through the compiled route table — the same object
 * `Bun.serve()` is handed, so this exercises registration too, not just the
 * handler closure.
 */
function call(method: string, path: string): Promise<Response> {
  const compiled = Router.compile(new Container(), []) as Record<
    string,
    Record<string, (req: Request) => Response | Promise<Response>>
  >;
  const [pathname] = path.split("?");

  // Exact key first, then a `:param` pattern — Bun matches patterns at serve
  // time, so the compiled table is keyed by `/entries/:id`, not `/entries/one`.
  const key =
    pathname! in compiled
      ? pathname!
      : Object.keys(compiled).find((pattern) =>
          new RegExp(`^${pattern.replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, "[^/]+")}$`).test(pathname!),
        );

  const handler = key ? compiled[key]?.[method] : undefined;
  if (!handler) throw new Error(`No route compiled for ${method} ${pathname}`);
  return Promise.resolve(handler(new Request(`http://localhost${path}`, { method })));
}

function entry(id: string, component: string, requestType: DevtoolsEntry["__meta"]["requestType"]) {
  return {
    __meta: {
      id,
      method: "GET",
      url: `https://app.test/${id}`,
      status: 200,
      requestType,
      component,
      timestamp: "2026-08-15T00:00:00.000Z",
      utime: 1786752000,
      tabUuid: null,
      batchId: null,
      serverTimingMs: 1,
    },
    http: {
      requestHeaders: {},
      responseHeaders: {},
      requestBody: { status: "empty" },
      responseBody: { status: "empty" },
    },
    props: {},
    route: { uri: "/x", name: null, action: null },
    renderSource: null,
    componentPath: null,
  } satisfies DevtoolsEntry;
}

describe("devtools read API", () => {
  beforeEach(() => {
    Bun.env["APP_ENV"] = "development";
    Router.reset();
    clearEntries();
    registerDevtoolsApi();
    putEntry(entry("one", "Posts/Index", "navigate"));
    putEntry(entry("two", "Posts/Show", "prefetch"));
  });

  afterEach(() => {
    if (priorEnv === undefined) delete Bun.env["APP_ENV"];
    else Bun.env["APP_ENV"] = priorEnv;
  });

  it("lists entries newest-first as JSON", async () => {
    const response = await call("GET", `${DEVTOOLS_API_PREFIX}/entries`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    // The timeline changes per request; a cached copy is always the wrong one.
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const body = (await response.json()) as DevtoolsEntry[];
    expect(body.map((e) => e.__meta.id)).toEqual(["two", "one"]);
  });

  it("applies the query-string filters", async () => {
    const filtered = await call("GET", `${DEVTOOLS_API_PREFIX}/entries?component=Posts/Show`);
    const body = (await filtered.json()) as DevtoolsEntry[];
    expect(body.map((e) => e.__meta.id)).toEqual(["two"]);

    const excluded = await call("GET", `${DEVTOOLS_API_PREFIX}/entries?exclude=prefetch`);
    expect(((await excluded.json()) as DevtoolsEntry[]).map((e) => e.__meta.id)).toEqual(["one"]);
  });

  it("serves one entry by id, and 404s for an unknown one", async () => {
    const found = await call("GET", `${DEVTOOLS_API_PREFIX}/entries/one`);
    expect(found.status).toBe(200);
    expect(((await found.json()) as DevtoolsEntry).__meta.id).toBe("one");

    const missing = await call("GET", `${DEVTOOLS_API_PREFIX}/entries/nope`);
    expect(missing.status).toBe(404);
  });

  it("clears the timeline on DELETE", async () => {
    const cleared = await call("DELETE", `${DEVTOOLS_API_PREFIX}/entries`);
    expect(cleared.status).toBe(204);

    const after = await call("GET", `${DEVTOOLS_API_PREFIX}/entries`);
    expect(await after.json()).toEqual([]);
  });

  it("refuses every read outside a dev process when no gate is configured", async () => {
    // Not a default-allow: an app that enabled the recorder in production without
    // saying who may read it has not made a decision this code should make for it.
    Bun.env["APP_ENV"] = "production";

    for (const path of [`${DEVTOOLS_API_PREFIX}/entries`, `${DEVTOOLS_API_PREFIX}/entries/one`]) {
      const response = await call("GET", path);
      expect(response.status).toBe(403);
    }
    expect((await call("DELETE", `${DEVTOOLS_API_PREFIX}/entries`)).status).toBe(403);
  });
});
