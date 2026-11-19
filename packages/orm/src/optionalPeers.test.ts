/**
 * `@zerotal/validator` is an optional peer of the ORM: the database provider loads it at boot to
 * wire its `unique()` and `exists()` rules to the connection.
 *
 * This workspace installs every package, so an app without it, or with a copy that fails to
 * load, is reproduced the way a compiled app meets it: the fixture is bundled with the validator
 * left out, then run in a directory where it is absent or broken. Bundled with it, the package
 * must be embedded and wired, so a `unique()` rule reaches the database with nothing installed.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = `${import.meta.dir}/__fixtures__/validator-peer.ts`;
const PEER = "@zerotal/validator";
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
): Promise<Record<string, Record<string, unknown> | null>> {
  const dir = mkdtempSync(join(tmpdir(), "zerotal-orm-peer-"));
  dirs.push(dir);
  mkdirSync(join(dir, "node_modules"));
  if (broken) {
    const pkg = join(dir, "node_modules", ...PEER.split("/"));
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: PEER, main: "index.js" }));
    writeFileSync(join(pkg, "index.js"), `throw new Error("validator failed to initialise");\n`);
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

describe("DatabaseProvider and @zerotal/validator", () => {
  it("boots without it: an app without the validator has no rules to wire", async () => {
    const { boot, uniqueRule } = await runBundled([PEER]);
    expect(boot).toEqual({ booted: true });
    expect(uniqueRule).toBeNull();
  }, 60_000);

  it("stops the boot with a copy that fails while loading, rather than skipping it", async () => {
    // Skipping it left unique() and exists() failing later, with no reason given.
    const { boot } = await runBundled([PEER], true);
    expect(boot).toEqual({ threw: "Error", message: "validator failed to initialise" });
  }, 60_000);

  it("is embedded in a bundle and wired, so unique() reaches the database", async () => {
    const { boot, uniqueRule } = await runBundled([]);
    expect(boot).toEqual({ booted: true });
    expect(uniqueRule).toEqual({ success: false, error: "The email has already been taken." });
  }, 60_000);
});
