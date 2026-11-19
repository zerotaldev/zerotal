/**
 * Flow's browser scripts: built when the package is packed, served at URLs named
 * after their content, and carried inside a compiled app.
 *
 * Three promises are tested here, each where it can actually be broken:
 *
 * - **The URL is the content.** The same bytes give the same URL and any change
 *   gives another, so a year-long `immutable` cache can never serve a stale
 *   runtime. Checked on the hash itself and on a running server.
 * - **The package ships the build, not the inputs.** Only a real `bun pm pack`
 *   shows what a tarball holds — `files` globs and the `prepack` hook are both
 *   easy to get subtly wrong, and either mistake reaches every app.
 * - **A compiled app serves the runtime.** An unbundled run reads files off disk
 *   and can never fail the way a binary does, so this compiles one with
 *   `bun build --compile` and runs it from an empty directory.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application, Router } from "@zerotal/core";
import { FlowProvider } from "./provider/FlowProvider.ts";
import { CounterPage } from "./browser/__fixtures__/CounterPage.tsx";
import { _clientAsset, _routeTablePrelude, _runtimeAsset } from "./clientAssets.ts";
import {
  _buildClientBundle,
  _CLIENT_BUNDLE_NAMES,
  _loadClientBundle,
  _readPrebuiltBundle,
} from "./clientBundles.ts";
import { flowEnhanceTag } from "./enhanceTag.ts";

const PKG = join(import.meta.dir, "..");
const IMMUTABLE = "public, max-age=31536000, immutable";
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

/** Build `dist/` the way `prepack` does, with the Bun running these tests. */
async function buildDist(): Promise<void> {
  await run([process.execPath, "scripts/build-client.ts"], PKG);
}

/** The `src` of every `<script src>` in a page, in document order. */
function scriptSources(html: string): string[] {
  return [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]!);
}

describe("a script's URL", () => {
  it("is the same for the same bytes, however they arrive", () => {
    const code = "window.flow = 1;";
    const a = _clientAsset("runtime", code);
    const b = _clientAsset("runtime", new TextEncoder().encode(code));
    expect(a.path).toBe(b.path);
    expect(a.path).toMatch(/^\/__flow\/assets\/runtime\.[0-9a-f]{16}\.js$/);
  });

  it("changes when a single byte does", () => {
    expect(_clientAsset("runtime", "window.flow = 1;").path).not.toBe(
      _clientAsset("runtime", "window.flow = 2;").path,
    );
  });

  it("is named after the script it serves", () => {
    expect(_clientAsset("enhance", "x").path).toStartWith("/__flow/assets/enhance.");
  });
});

describe("serving the scripts", () => {
  let app: Application;
  let base: string;
  let page: string;

  beforeAll(async () => {
    Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
    Application._resetInstance();
    app = Application.create({ env: "web", providers: [FlowProvider] });
    await app.boot();
    Router.flow("/assets/counter", CounterPage);
    await app.start(0);
    const server = (app as unknown as { _static?: { port: number } })._static;
    base = `http://localhost:${server?.port}`;
    page = await (await fetch(`${base}/assets/counter`)).text();
  }, SLOW);

  afterAll(async () => {
    await app?.close?.();
  });

  it("links the route table, then the runtime, both at hashed URLs", () => {
    const [routes, runtime, ...rest] = scriptSources(page);
    expect(rest).toEqual([]);
    expect(routes).toMatch(/^\/__flow\/assets\/routes\.[0-9a-f]{16}\.js$/);
    expect(runtime).toBe(_runtimeAsset()!.path);
    // Both deferred, so they run in document order once parsing is done: the
    // table is installed before the runtime reads it.
    expect(page).toContain(`<script src="${routes}" defer></script>`);
    expect(page).toContain(`<script src="${runtime}" defer></script>`);
  });

  it("serves the runtime cacheable for a year, never revalidated", async () => {
    const runtime = _runtimeAsset()!;
    const res = await fetch(base + runtime.path);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("etag")).toBe(`"${runtime.hash}"`);
    // A raw route still carries the security headers the pipeline would add.
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(runtime.body);
  });

  it("answers a browser that already holds it with 304", async () => {
    const runtime = _runtimeAsset()!;
    const res = await fetch(base + runtime.path, {
      headers: { "If-None-Match": `"${runtime.hash}"` },
    });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("answers HEAD with the length and no body", async () => {
    const runtime = _runtimeAsset()!;
    const res = await fetch(base + runtime.path, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(runtime.body.byteLength));
  });

  it("serves the route table as the script the page linked", async () => {
    const [routes] = scriptSources(page);
    const res = await fetch(base + routes!);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(await res.text()).toBe(_routeTablePrelude());
  });

  it("sends a page from an earlier deploy to the current runtime, uncached", async () => {
    const res = await fetch(`${base}/__flow/assets/runtime.0123456789abcdef.js`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(_runtimeAsset()!.path);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not answer for a script it has never served", async () => {
    const res = await fetch(`${base}/__flow/assets/nothing.0123456789abcdef.js`);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("names the plain-form enhancement by its hash in the tag a layout uses", async () => {
    const [src] = scriptSources(flowEnhanceTag());
    expect(src).toMatch(/^\/__flow\/assets\/enhance\.[0-9a-f]{16}\.js$/);
    const res = await fetch(base + src!);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    // And the old unhashed path serves the same bytes, for a layout that names it.
    const legacy = await fetch(`${base}/__flow/enhance.js`);
    expect(legacy.status).toBe(200);
    expect(await legacy.text()).toBe(await res.text());
  });

  it("keeps /__flow/runtime.js working, route table first, never cached", async () => {
    const res = await fetch(`${base}/__flow/runtime.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).toStartWith(_routeTablePrelude());
    expect(body.slice(_routeTablePrelude().length)).toBe(
      new TextDecoder().decode(_runtimeAsset()!.body),
    );
  });
});

describe("where the bundles come from", () => {
  it(
    "builds them from source in a checkout, so an edit is never hidden by an old dist/",
    async () => {
      // This file is in a checkout, so the entries are here. Even with a dist/ left
      // behind by an earlier pack, the source wins.
      await buildDist();
      for (const name of _CLIENT_BUNDLE_NAMES) {
        const loaded = await _loadClientBundle(name, true);
        expect(loaded.ok && loaded.from).toBe("source");
      }
    },
    SLOW,
  );

  it(
    "ships in dist/ exactly what a minified build of the source produces",
    async () => {
      await buildDist();
      for (const name of _CLIENT_BUNDLE_NAMES) {
        const prebuilt = await _readPrebuiltBundle(name);
        expect(prebuilt).toBe(readFileSync(join(PKG, "dist", `${name}.js`), "utf8"));
        const built = await _buildClientBundle(name, true);
        expect(built.ok && built.code).toBe(prebuilt!);
        // Each is loaded as a classic script, where an `export` or `import` statement
        // is a syntax error that discards the whole file.
        expect(prebuilt).not.toMatch(/^(export|import)[\s{]/m);
      }
    },
    SLOW,
  );
});

describe("the published package", () => {
  let dir: string;
  let files: string[];
  let manifest: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "zt-flow-pack-"));
    // `bun pm pack` runs `prepack`, which is what builds dist/ — the same path the
    // release script takes.
    const out = await run([process.execPath, "pm", "pack", "--destination", dir, "--quiet"], PKG);
    // A basename and a cwd, never an absolute path: Windows' tar reads `C:` as a host.
    const tarball = out.trim().split("\n").at(-1)!.trim().split(/[\\/]/).at(-1)!;
    files = (await run(["tar", "-tzf", tarball], dir)).split(/\r?\n/).filter(Boolean);
    manifest = JSON.parse(await run(["tar", "-xzOf", tarball, "package/package.json"], dir));
  }, SLOW);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("carries the built bundles and the index that embeds them", () => {
    for (const file of ["runtime.js", "runtime.csp.js", "enhance.js", "assets.js"]) {
      expect(files).toContain(`package/dist/${file}`);
    }
  });

  it("leaves out the entries the bundles are built from", () => {
    for (const file of ["index.ts", "index.csp.ts", "enhance.ts", "alpinejs-morph.d.ts"]) {
      expect(files).not.toContain(`package/src/client/${file}`);
    }
    // …and only those: the server imports other modules in src/client/.
    expect(files).toContain("package/src/client/url.ts");
  });

  it("does not install Alpine into the app", () => {
    const runtime = Object.keys(manifest.dependencies ?? {});
    expect(runtime.filter((dep) => dep === "alpinejs" || dep.startsWith("@alpinejs/"))).toEqual([]);
    expect(manifest.devDependencies?.["alpinejs"]).toBeDefined();
  });
});

describe("a compiled app", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "zt-flow-compiled-"));
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it(
    "serves the runtime from inside the binary",
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

      // Run from the temp directory: no node_modules and no dist/ anywhere a path could reach.
      const app = Bun.spawn([outfile], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          APP_KEY: "compiled-app-key-aaaaaaaaaaaaaaaaaaaa",
          APP_ENV: "production",
        },
      });
      try {
        const port = await portOf(app);
        const html = await (await fetch(`http://localhost:${port}/probe`)).text();
        const [routes, runtime] = scriptSources(html);
        expect(runtime).toMatch(/^\/__flow\/assets\/runtime\.[0-9a-f]{16}\.js$/);

        const res = await fetch(`http://localhost:${port}${runtime}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
        expect(await res.text()).toBe(readFileSync(join(PKG, "dist", "runtime.js"), "utf8"));
        expect((await fetch(`http://localhost:${port}${routes}`)).status).toBe(200);

        // The enhancement is embedded too, and its tag names it by hash.
        const plain = await (await fetch(`http://localhost:${port}/plain`)).text();
        const [enhance] = scriptSources(plain);
        expect(enhance).toMatch(/^\/__flow\/assets\/enhance\.[0-9a-f]{16}\.js$/);
        expect(await (await fetch(`http://localhost:${port}${enhance}`)).text()).toBe(
          readFileSync(join(PKG, "dist", "enhance.js"), "utf8"),
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
