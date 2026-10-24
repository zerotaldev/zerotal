import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { rm } from "node:fs/promises";
import { Application, _shieldCatchAlls } from "./Application.ts";
import { Router } from "../router/Router.ts";

/**
 * A single-page app's catch-all route answered for files that were not there.
 *
 * Bun matches `routes` before it calls `fetch`, so the shell route (`/*`) took every path the
 * table had no exact entry for. The dev server's lookup for files written after boot never ran,
 * so each rebuild's fresh `chunk-<hash>.js` came back as the HTML shell with status 200, and a
 * stale tab asking for a chunk a deploy had removed got the same. The browser's complaint is
 * "Expected a JavaScript module script but the server responded with a MIME type of text/html".
 *
 * These run a real server: the behaviour under test is Bun's route matching, which a stub of
 * the table would not reproduce.
 */
const TMP = `${import.meta.dir}/.tmp-catch-all-${Date.now()}`;
const PUBLIC = `${TMP}/public`;

const SHELL = "<html>app shell</html>";
const shell = () =>
  new Response(SHELL, { headers: { "Content-Type": "text/html; charset=utf-8" } });

type Table = Parameters<typeof _shieldCatchAlls>[0];

/** The routes a SPA app compiles to: a shell catch-all, one real page, one real asset. */
function table(): Table {
  return {
    "/*": { GET: shell, POST: () => new Response("posted") },
    "/login": { GET: () => new Response("login page") },
    "/assets/app.js": new Response("entry", { headers: { "Content-Type": "text/javascript" } }),
  };
}

const servers: Array<{ stop(force?: boolean): void }> = [];

function serve(routes: Table, dirs = [] as Array<{ prefix: string; rootDir: string }>) {
  const server = Bun.serve({
    port: 0,
    routes: _shieldCatchAlls(routes, dirs),
    fetch: () => new Response("fetch fallback", { status: 418 }),
  });
  servers.push(server);
  return (path: string, init?: RequestInit) =>
    fetch(`http://localhost:${server.port}${path}`, init);
}

beforeAll(async () => {
  await Bun.write(`${PUBLIC}/assets/app.js`, "entry");
});

afterAll(async () => {
  for (const server of servers) server.stop(true);
  await rm(TMP, { recursive: true, force: true });
});

describe("a catch-all route and a missing asset", () => {
  it("answers 404, not the shell, for a script that does not exist", async () => {
    const get = serve(table());

    const res = await get("/assets/chunk-gone.js");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).not.toContain("text/html");
  });

  it.each(["/assets/chunk-gone.mjs", "/assets/app.css", "/assets/app.js.map", "/x/y/mod.wasm"])(
    "answers 404 for %s",
    async (path) => {
      expect((await serve(table())(path)).status).toBe(404);
    },
  );

  it("still answers a page navigation with the shell", async () => {
    const get = serve(table());

    for (const path of ["/", "/dashboard", "/orders/42", "/a/b/c"]) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(SHELL);
    }
  });

  it("still answers a path with another extension with the shell, since a page may live there", async () => {
    const res = await serve(table())("/sitemap.xml");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SHELL);
  });

  it("leaves a more specific route alone: an exact page and a pre-registered asset", async () => {
    const get = serve(table());

    expect(await (await get("/login")).text()).toBe("login page");
    const asset = await get("/assets/app.js");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("entry");
  });

  it("does not touch a request that is not a GET or a HEAD", async () => {
    const res = await serve(table())("/assets/anything.js", { method: "POST" });

    expect(await res.text()).toBe("posted");
  });

  it("answers HEAD the way it answers GET", async () => {
    const res = await serve(table())("/assets/chunk-gone.js", { method: "HEAD" });

    expect(res.status).toBe(404);
  });

  it("applies to a catch-all under a prefix too", async () => {
    const get = serve({ "/app/*": { GET: shell } });

    expect((await get("/app/chunk-gone.js")).status).toBe(404);
    expect(await (await get("/app/dashboard")).text()).toBe(SHELL);
  });

  it("changes nothing for a table with no catch-all", () => {
    const routes = { "/login": { GET: () => new Response("x") } };

    expect(_shieldCatchAlls(routes, [])["/login"]).toBe(routes["/login"]);
  });
});

describe("a file written after the server started, with a catch-all in the table", () => {
  const dirs = [{ prefix: "/", rootDir: PUBLIC }];

  it("is served, with its own content type, instead of the shell", async () => {
    const get = serve(table(), dirs);
    expect((await get("/assets/chunk-fresh.js")).status).toBe(404);

    await Bun.write(`${PUBLIC}/assets/chunk-fresh.js`, "export const rebuilt = true;");

    const res = await get("/assets/chunk-fresh.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("export const rebuilt = true;");
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  it("is served whatever its extension, so the lookup is not limited to scripts", async () => {
    await Bun.write(`${PUBLIC}/assets/logo-fresh.svg`, "<svg/>");

    const res = await serve(table(), dirs)("/assets/logo-fresh.svg");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<svg/>");
  });

  it("does not let a request reach outside the served directory", async () => {
    await Bun.write(`${TMP}/secret.js`, "secret");

    const res = await serve(table(), dirs)("/assets/..%2f..%2fsecret.js");

    expect(await res.text()).not.toBe("secret");
  });
});

describe("the server Application starts", () => {
  const origServe = (Bun as unknown as Record<string, unknown>).serve;

  afterEach(() => {
    (Bun as unknown as Record<string, unknown>).serve = origServe;
    Application._resetInstance();
  });

  it("is given the shielded table, so a missing script is a 404 and not the shell", async () => {
    Application._resetInstance();
    const app = Application.create({ env: "web" });
    Router.get("/*", shell);
    let routes: Table | undefined;
    (Bun as unknown as Record<string, unknown>).serve = (opts: { routes: Table }) => {
      routes = opts.routes;
      return { stop: () => {} };
    };

    await app.start(0);

    const handler = (routes!["/*"] as Record<string, (req: Request) => Promise<Response>>)["GET"]!;
    const gone = await handler(new Request("http://localhost/assets/chunk-gone.js"));
    const page = await handler(new Request("http://localhost/dashboard"));

    expect(gone.status).toBe(404);
    expect(page.status).toBe(200);
  });
});
