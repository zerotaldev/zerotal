/**
 * The inspector's browser bundles: built when the package is packed, served at
 * URLs named after their content, and carried inside a compiled app.
 *
 * The pack and the compiled binary are each tested for real — `bun pm pack` and
 * `bun build --compile` — because the mistakes they catch (a `files` glob that
 * ships the wrong thing, a bundle read from a path a binary does not have) are
 * invisible to a test that runs the source.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpContext, RequestContext } from "@zerotal/core";
import { DevtoolsInjectionMiddleware } from "./DevtoolsInjectionMiddleware.ts";
import {
  _buildDevtoolsBundle,
  _DEVTOOLS_BUNDLE_NAMES,
  _devtoolsAsset,
  _hasDevtoolsSource,
  _loadDevtoolsAssets,
  _readPrebuiltDevtoolsBundle,
} from "./clientAssets.ts";

const PKG = join(import.meta.dir, "..");
const IMMUTABLE = "private, max-age=31536000, immutable";
const SLOW = 180_000;

/** Run a command to completion, failing with its output when it exits non-zero. */
async function run(cmd: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}:\n${out}\n${err}`);
  return out;
}

async function buildDist(): Promise<void> {
  await run([process.execPath, "scripts/build-client.ts"], PKG);
}

/** Send one request through the middleware, as the pipeline would. */
async function hit(url: string, headers?: Record<string, string>): Promise<Response> {
  const ctx = HttpContext.fake(url);
  if (headers) for (const [k, v] of Object.entries(headers)) ctx.request.headers.set(k, v);
  const mw = new DevtoolsInjectionMiddleware();
  let out: Response | undefined;
  await RequestContext.run(ctx, async () => {
    const result = await mw.handle(ctx, async () => undefined);
    if (result instanceof Response) out = result;
  });
  if (!out) throw new Error(`the middleware did not answer ${url}`);
  return out;
}

describe("a bundle's URL", () => {
  it("is the same for the same bytes and changes with any of them", () => {
    expect(_devtoolsAsset("client", "a").path).toBe(_devtoolsAsset("client", "a").path);
    expect(_devtoolsAsset("client", "a").path).not.toBe(_devtoolsAsset("client", "b").path);
    expect(_devtoolsAsset("dashboard", "a").path).toMatch(
      /^\/__zerotal\/devtools\/assets\/dashboard\.[0-9a-f]{16}\.js$/,
    );
  });
});

describe("serving the bundles", () => {
  const priorEnv = Bun.env["APP_ENV"];
  beforeAll(() => {
    Bun.env["APP_ENV"] = "development";
  });
  afterAll(() => {
    if (priorEnv === undefined) delete Bun.env["APP_ENV"];
    else Bun.env["APP_ENV"] = priorEnv;
  });

  it("links the dashboard from the inspector page by its hash", async () => {
    const assets = await _loadDevtoolsAssets();
    const page = await (await hit("http://localhost/__zerotal/devtools")).text();
    expect(page).toContain(`<script type="module" src="${assets.dashboard!.path}"></script>`);
  });

  it("serves each bundle for a year, to this browser only", async () => {
    const assets = await _loadDevtoolsAssets();
    for (const name of _DEVTOOLS_BUNDLE_NAMES) {
      const asset = assets[name]!;
      const res = await hit(`http://localhost${asset.path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
      expect(res.headers.get("etag")).toBe(`"${asset.hash}"`);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(asset.body);
    }
  });

  it("answers a browser that already holds a bundle with 304", async () => {
    const client = (await _loadDevtoolsAssets()).client!;
    const res = await hit(`http://localhost${client.path}`, {
      "If-None-Match": `"${client.hash}"`,
    });
    expect(res.status).toBe(304);
  });

  it("sends a tab left open across an upgrade to the current bundle", async () => {
    const client = (await _loadDevtoolsAssets()).client!;
    const res = await hit("http://localhost/__zerotal/devtools/assets/client.0123456789abcdef.js");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(client.path);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await hit("http://localhost/__zerotal/devtools/assets/other.js")).status).toBe(404);
  });

  it("keeps the unhashed paths, revalidated each time, serving the same bytes", async () => {
    const assets = await _loadDevtoolsAssets();
    for (const name of _DEVTOOLS_BUNDLE_NAMES) {
      const res = await hit(`http://localhost/__zerotal/devtools/${name}.js`);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(assets[name]!.body);
    }
  });
});

describe("where the bundles come from", () => {
  it("builds them from source in a checkout", () => {
    for (const name of _DEVTOOLS_BUNDLE_NAMES) expect(_hasDevtoolsSource(name)).toBe(true);
  });

  it(
    "ships in dist/ exactly what the source builds to",
    async () => {
      await buildDist();
      for (const name of _DEVTOOLS_BUNDLE_NAMES) {
        const prebuilt = await _readPrebuiltDevtoolsBundle(name);
        expect(prebuilt).toBe(readFileSync(join(PKG, "dist", `${name}.js`), "utf8"));
        const built = await _buildDevtoolsBundle(name);
        expect(built.ok && built.code).toBe(prebuilt!);
      }
    },
    SLOW,
  );
});

describe("the published package", () => {
  let dir: string;
  let files: string[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "zt-devtools-pack-"));
    const out = await run([process.execPath, "pm", "pack", "--destination", dir, "--quiet"], PKG);
    // A basename and a cwd, never an absolute path: Windows' tar reads `C:` as a host.
    const tarball = out.trim().split("\n").at(-1)!.trim().split(/[\\/]/).at(-1)!;
    files = (await run(["tar", "-tzf", tarball], dir)).split(/\r?\n/).filter(Boolean);
  }, SLOW);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("carries the built bundles and their index", () => {
    for (const file of ["client.js", "dashboard.js", "assets.js"]) {
      expect(files).toContain(`package/dist/${file}`);
    }
  });

  it("leaves out the entries, and keeps the client an app can import itself", () => {
    expect(files).not.toContain("package/src/client-auto.ts");
    expect(files).not.toContain("package/src/dashboard-auto.ts");
    // `@zerotal/devtools/client` is a public subpath.
    expect(files).toContain("package/src/client/index.ts");
  });
});

describe("a compiled app", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "zt-devtools-compiled-"));
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it(
    "serves the panel and the dashboard from inside the binary",
    async () => {
      await buildDist();
      const outfile = join(dir, process.platform === "win32" ? "app.exe" : "app");
      await run(
        [
          process.execPath,
          "build",
          "--compile",
          "--target=bun",
          join(import.meta.dir, "__fixtures__", "compiled-app.ts"),
          `--outfile=${outfile}`,
        ],
        PKG,
      );

      const app = Bun.spawn([outfile], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          APP_KEY: "compiled-app-key-aaaaaaaaaaaaaaaaaaaa",
          APP_ENV: "development",
        },
      });
      try {
        const base = `http://localhost:${await portOf(app)}`;

        const panel = await (await fetch(`${base}/__zerotal/devtools`)).text();
        const dashboard = /src="([^"]+)"/.exec(panel)?.[1];
        expect(dashboard).toMatch(/^\/__zerotal\/devtools\/assets\/dashboard\.[0-9a-f]{16}\.js$/);
        const res = await fetch(base + dashboard!);
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
        expect(await res.text()).toBe(readFileSync(join(PKG, "dist", "dashboard.js"), "utf8"));

        // The panel injected into an app page names the client the same way.
        const page = await (await fetch(`${base}/page`)).text();
        const client = /\/__zerotal\/devtools\/assets\/client\.[0-9a-f]{16}\.js/.exec(page)?.[0];
        expect(client).toBeDefined();
        expect(await (await fetch(base + client!)).text()).toBe(
          readFileSync(join(PKG, "dist", "client.js"), "utf8"),
        );
      } finally {
        app.kill();
        await app.exited;
      }
    },
    SLOW,
  );
});

/** Read the port a compiled fixture prints as `{"port":…}`, or fail with what it said instead. */
async function portOf(app: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<number> {
  const reader = app.stdout.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value, { stream: true });
    const line = seen.split("\n").find((l) => l.startsWith('{"port"'));
    if (line) {
      reader.releaseLock();
      return (JSON.parse(line) as { port: number }).port;
    }
  }
  throw new Error(
    `the compiled app never reported a port.\nstdout: ${seen}\nstderr: ${await new Response(app.stderr).text()}`,
  );
}
