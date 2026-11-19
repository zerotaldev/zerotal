/**
 * `@zerotal/broadcasting` is an optional peer of flow: `@presence` and `@shared` load it when a
 * page uses them.
 *
 * This workspace installs every package, so an app without it, or with a copy that fails to
 * load, is reproduced the way a compiled app meets it: the fixture is bundled with broadcasting
 * left out, then run in a directory where it is absent or broken. Bundled with it, the package
 * must be embedded and be the copy flow reaches. It was not, while flow named it through a
 * variable: the bundler could not see the name, so a compiled app lost broadcasting even with it
 * installed.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = `${import.meta.dir}/__fixtures__/broadcasting-peer.ts`;
const PEER = "@zerotal/broadcasting";
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Run `cmd` in `cwd` and return the last line it printed, failing on a non-zero exit. */
async function run(cmd: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}: ${err}`);
  return out.trim().split("\n").at(-1)!;
}

/**
 * Bundle the fixture, leaving `external` out, into an app directory with nothing installed, and
 * run it there. The empty `node_modules` turns Bun's auto-install off. With `broken`, the app has
 * a copy of the peer that throws while loading.
 */
async function runBundled(
  external: string[],
  broken = false,
): Promise<Record<string, Record<string, unknown>>> {
  const dir = mkdtempSync(join(tmpdir(), "zerotal-flow-peer-"));
  dirs.push(dir);
  mkdirSync(join(dir, "node_modules"));
  if (broken) {
    const pkg = join(dir, "node_modules", ...PEER.split("/"));
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: PEER, main: "index.js" }));
    writeFileSync(join(pkg, "index.js"), `throw new Error("broadcasting failed to initialise");\n`);
  }
  const bundle = join(dir, "app.js");
  await run(
    [
      process.execPath,
      "build",
      "--target=bun",
      FIXTURE,
      `--outfile=${bundle}`,
      ...external.flatMap((name) => ["--external", name]),
    ],
    dir,
  );
  return JSON.parse(await run([process.execPath, "--no-install", bundle], dir));
}

describe("@presence and @shared without @zerotal/broadcasting", () => {
  it("fall back as documented: presence keeps its default, shared converges in-process", async () => {
    const result = await runBundled([PEER]);
    expect(result).toEqual({
      presence: { members: [] },
      shared: { changed: ["notes"], broadcasts: null },
    });
  }, 60_000);
});

describe("@presence and @shared with a broadcasting package that fails while loading", () => {
  it("rethrow its error, rather than treating it as not installed", async () => {
    const result = await runBundled([PEER], true);
    const broken = { threw: "Error", message: "broadcasting failed to initialise" };
    expect(result).toEqual({ presence: broken, shared: broken });
  }, 60_000);
});

describe("@shared with @zerotal/broadcasting bundled", () => {
  it("reaches the embedded copy, so a compiled app broadcasts with nothing installed", async () => {
    // The app's fake recorded the change, so flow loaded the same copy the bundle embedded.
    const result = await runBundled([]);
    expect(result["shared"]).toEqual({ changed: ["notes"], broadcasts: ["presence-board"] });
  }, 60_000);
});
