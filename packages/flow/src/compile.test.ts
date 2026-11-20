/**
 * A binary built by `bun zt compile` carries the app's own files: its config, its Flow pages
 * compiled ahead of time with the app's tsconfig, and the middleware beside them. It is run from
 * a directory that holds none of them, with no node_modules anywhere above it.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _precompilePages } from "./compiler/index.ts";

const APP = join(import.meta.dir, "__fixtures__", "compiled-files-app");
const COMPILE = join(
  import.meta.dir,
  "..",
  "..",
  "core",
  "src",
  "command",
  "builtin",
  "CompileCommand.ts",
);
const SLOW = 180_000;

describe("_precompilePages", () => {
  it("compiles a page in both CSP modes and leaves a non-page alone", async () => {
    const { builds, modules } = await _precompilePages(APP, [
      "app/flow/pages/index.tsx",
      "app/flow/pages/docs/_middleware.ts",
    ]);
    const [plain, csp] = builds["app/flow/pages/index.tsx"] ?? [];
    expect(plain).toMatchObject({ outcome: "compiled" });
    expect(csp).toMatchObject({ outcome: "compiled" });
    // Module paths are root-relative, so they mean the same thing where the binary runs, and the
    // modules import by path: Bun 1.3's bundler does not resolve a file:// specifier.
    expect(modules.length).toBeGreaterThan(0);
    for (const path of modules) {
      expect(path.startsWith(".zerotal/compile/flow/")).toBe(true);
      expect(await Bun.file(join(APP, path)).text()).not.toContain("file://");
    }
    expect(builds["app/flow/pages/docs/_middleware.ts"]).toBeUndefined();
  });
});

describe("a binary built by bun zt compile", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "zt-compiled-files-"));
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it(
    "serves the app's pages, middleware and config from inside itself",
    async () => {
      const outfile = join(dir, process.platform === "win32" ? "app.exe" : "app");
      const script =
        `const { CompileCommand } = await import(${JSON.stringify(COMPILE)});` +
        `const command = new CompileCommand();` +
        `command.flags = { outfile: ${JSON.stringify(outfile)}, entry: "zt.ts" };` +
        `await command.run();`;
      const build = Bun.spawn([process.execPath, "-e", script], {
        cwd: APP,
        stdout: "pipe",
        stderr: "pipe",
      });
      if ((await build.exited) !== 0) {
        throw new Error(
          `compile failed:\n${await new Response(build.stdout).text()}\n` +
            (await new Response(build.stderr).text()),
        );
      }

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
        const { port, output } = await portOf(app);
        // Both pages were compiled when the binary was built, and boot found them there.
        expect(output).toContain(
          "Compiled 0 page(s), 2 from cache, 0 bind-injected, 0 using runtime",
        );
        const home = await (await fetch(`http://localhost:${port}/`)).text();
        expect(home).toContain(`<p id="probe">a compiled page</p>`);

        const guide = await fetch(`http://localhost:${port}/docs/guide`);
        expect(guide.status).toBe(200);
        expect(await guide.text()).toContain("<h1>Guide</h1>");
        expect(guide.headers.get("x-stamped")).toBe("docs");

        expect(await (await fetch(`http://localhost:${port}/facts`)).json()).toEqual({
          config: "configured in the binary",
          configLoader: "configured in the binary",
        });
      } finally {
        app.kill();
        await app.exited;
      }
    },
    SLOW,
  );
});

/**
 * Read the port the fixture prints as `{"port":…}` and what it printed before it, or fail with
 * what it said instead.
 */
async function portOf(
  app: Bun.Subprocess<"ignore", "pipe", "pipe">,
): Promise<{ port: number; output: string }> {
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
      return { port: (JSON.parse(line) as { port: number }).port, output: Bun.stripANSI(seen) };
    }
  }
  throw new Error(
    `the compiled app never reported a port.\nstdout: ${seen}\nstderr: ${await new Response(app.stderr).text()}`,
  );
}
