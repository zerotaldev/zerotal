/**
 * `@zerotal/broadcasting` is an optional peer of notifications: the `broadcast` channel and the
 * queued broadcast job load it when they run.
 *
 * This workspace installs every package, so an app without it, or with a copy that fails to
 * load, is reproduced the way a compiled app meets it: the fixture is bundled with broadcasting
 * left out, then run in a directory where it is absent or broken. Bundled with it, the package
 * must be embedded, so the same calls find it with nothing installed.
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
): Promise<Record<string, Record<string, unknown> | null>> {
  const dir = mkdtempSync(join(tmpdir(), "zerotal-notifications-peer-"));
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

describe("the broadcast channel and @zerotal/broadcasting", () => {
  it("throws OptionalPeerMissingError naming the install command when it is absent", async () => {
    const { channel, job } = await runBundled([PEER]);
    const missing = {
      threw: "OptionalPeerMissingError",
      code: "E_OPTIONAL_PEER_MISSING",
      peer: PEER,
      install: `bun add ${PEER}`,
    };
    expect(channel).toMatchObject(missing);
    expect(channel!.message).toContain('"broadcast" in its channels()');
    expect(job).toMatchObject(missing);
    expect(job!.message).toContain("a queued broadcast notification");
  }, 60_000);

  it("rethrows a copy that fails while loading, rather than calling it missing", async () => {
    const { channel, job } = await runBundled([PEER], true);
    const broken = { threw: "Error", message: "broadcasting failed to initialise" };
    expect(channel).toMatchObject(broken);
    expect(job).toMatchObject(broken);
  }, 60_000);

  it("is embedded in a bundle, so a compiled app finds it with nothing installed", async () => {
    // Broadcasting itself answers: it was loaded, and only says its provider is not registered.
    const { channel, job } = await runBundled([]);
    expect(channel).toMatchObject({ code: "E_BROADCAST_NOT_REGISTERED" });
    expect(job).toMatchObject({ code: "E_BROADCAST_NOT_REGISTERED" });
  }, 60_000);
});
