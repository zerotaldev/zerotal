/**
 * The optional peers, loaded the way a compiled app and an app without them load them.
 *
 * Each fixture is built by the `bun build` CLI, as `bun zt compile` builds an app, and
 * run from a fresh temporary directory with no `node_modules` above it. The build runs
 * in its own process: Bun 1.3.14's in-process `Bun.build()` fails every build after
 * the first with "Unexpected reading file" once the test process has loaded the same
 * sources itself.
 *
 * `--no-install` matters for the bundle that leaves the peers out: without it Bun
 * answers a missing package outside any project by fetching it from the registry, so
 * "not installed" would quietly become "downloaded" and the check would pass for the
 * wrong reason.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PEERS = [
  "react",
  "react-dom",
  "@inertiajs/react",
  "vue",
  "@inertiajs/vue3",
  "@vue/compiler-sfc",
];

/** Run a command to completion; fail with its stderr when it exits non-zero. */
async function run(cmd: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}:\n${err}${out}`);
  return out;
}

/** The JSON line a fixture prints last. */
function lastJson(out: string): any {
  return JSON.parse(out.trim().split("\n").at(-1)!);
}

const fixture = (name: string): string => `${import.meta.dir}/__fixtures__/${name}`;

describe("optional peers in a binary from `bun build --compile`", () => {
  let dir = "";
  let result: any;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "zt-inertia-compiled-"));
    const outfile = join(dir, "peers");
    await run(
      [
        process.execPath,
        "build",
        "--compile",
        "--target=bun",
        fixture("peers-bundled.ts"),
        `--outfile=${outfile}`,
      ],
      import.meta.dir,
    );
    const binary = process.platform === "win32" ? `${outfile}.exe` : outfile;
    result = lastJson(await run([binary], dir));
  }, 120_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // The loaders name each package with a literal, so the bundler embeds it. A
  // variable specifier builds just as happily and leaves the package out, which is
  // only found when the binary runs somewhere without node_modules.
  it("embeds React and its Inertia adapter, and renders a page with them", () => {
    expect(result.react).toBe('<p class="react">Hello, Ada</p>');
  });

  it("embeds Vue and its Inertia adapter, and renders a page with them", () => {
    expect(result.vue).toContain('<p class="vue">Hello, Ada</p>');
    expect(result.vue).toContain('data-server-rendered="true"');
  });

  it("embeds the .vue compiler, and the build succeeds with it", () => {
    // The compiler's CommonJS entry point requires template engines nobody installs,
    // and with it in the graph this build failed outright.
    expect(result.compiler).toBe(true);
  });
});

describe("optional peers an app did not install", () => {
  let dir = "";
  let result: any;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "zt-inertia-absent-"));
    await run(
      [
        process.execPath,
        "build",
        "--target=bun",
        fixture("peers-absent.ts"),
        `--outdir=${dir}`,
        ...PEERS.flatMap((peer) => ["--external", peer]),
      ],
      import.meta.dir,
    );
    result = lastJson(await run([process.execPath, "--no-install", "peers-absent.js"], dir));
  }, 120_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("each loader names the package, what needed it, and the command that adds it", () => {
    const react = { feature: "Rendering a React page on the server" };
    const vue = { feature: "Rendering a .vue page on the server" };
    const expected: Record<string, { peer: string; feature: string; install: string }> = {
      react: { ...react, peer: "react", install: "bun add react react-dom @inertiajs/react" },
      "react-dom/server": {
        ...react,
        peer: "react-dom",
        install: "bun add react react-dom @inertiajs/react",
      },
      "@inertiajs/react": {
        ...react,
        peer: "@inertiajs/react",
        install: "bun add @inertiajs/react",
      },
      vue: { ...vue, peer: "vue", install: "bun add vue @inertiajs/vue3 @vue/compiler-sfc" },
      "vue/server-renderer": {
        ...vue,
        peer: "vue",
        install: "bun add vue @inertiajs/vue3 @vue/compiler-sfc",
      },
      "@inertiajs/vue3": { ...vue, peer: "@inertiajs/vue3", install: "bun add @inertiajs/vue3" },
      "@vue/compiler-sfc": {
        peer: "@vue/compiler-sfc",
        feature: "Compiling .vue pages",
        install: "bun add @vue/compiler-sfc",
      },
    };

    const { results } = result;
    expect(Object.keys(results).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, missing] of Object.entries(expected)) {
      expect(results[name]).toMatchObject({
        name: "OptionalPeerMissingError",
        code: "E_OPTIONAL_PEER_MISSING",
        missing,
      });
      expect(results[name].message).toContain(`Install it: ${missing.install}`);
    }
  });

  it("asks for the compiler at boot only when the app server-renders .vue files", () => {
    const { boot } = result;
    // A React app never needs it, whatever `inertia.ssr` says.
    expect(boot.reactSsr).toBe("ok");
    // A client-rendered Vue app compiles nothing on the server, so it still boots —
    // as it did before, when a deploy without the compiler worked.
    expect(boot.vueClientOnly).toBe("ok");
    // A server-rendered one cannot render a page, and is told at boot.
    expect(boot.vueSsr).toBe("E_OPTIONAL_PEER_MISSING");
  });

  it("has zt doctor name what is missing, for what the app does", () => {
    const { doctor } = result;

    expect(doctor.reactClientOnly.status).toBe("ok");
    expect(doctor.reactSsr).toEqual({
      status: "fail",
      message:
        'Server-rendered React pages need "react", "react-dom", "@inertiajs/react", which are not installed.',
      fix: "bun add react react-dom @inertiajs/react",
    });
    // Without server rendering a Vue app still needs the compiler, to build.
    expect(doctor.vueClientOnly).toEqual({
      status: "fail",
      message: 'Vue pages need "@vue/compiler-sfc", which is not installed.',
      fix: "bun add @vue/compiler-sfc",
    });
    expect(doctor.vueSsr.fix).toBe("bun add @vue/compiler-sfc vue @inertiajs/vue3");
  });

  it("builds without the compiler only when there is no .vue file to compile", () => {
    const { build } = result;
    expect(build.react).toBe(0);
    // Instead of the bundler's "no loader is configured for .vue files".
    expect(build.vue).toBe("E_OPTIONAL_PEER_MISSING");
  });
});
