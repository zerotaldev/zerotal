/**
 * `@zerotal/audit`, `@zerotal/queue` and `@zerotal/notifications` are optional peers of the
 * panel: record history, queued imports and the database notifications provider load them when
 * they run.
 *
 * This workspace installs every package, so an app without them, or with copies that fail to
 * load, is reproduced the way a compiled app meets it: the fixture is bundled with the three left
 * out, then run in a directory where they are absent or broken. Bundled with them, they must be
 * embedded, so the same calls find them with nothing installed.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = `${import.meta.dir}/__fixtures__/optional-peers.ts`;
const PEERS = ["@zerotal/audit", "@zerotal/queue", "@zerotal/notifications"];
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
 * a copy of each left-out package that throws while loading.
 */
async function runBundled(
  external: string[],
  broken = false,
): Promise<Record<string, Record<string, unknown>>> {
  const dir = mkdtempSync(join(tmpdir(), "zerotal-admin-peer-"));
  dirs.push(dir);
  mkdirSync(join(dir, "node_modules"));
  if (broken) {
    for (const peer of external) {
      const pkg = join(dir, "node_modules", ...peer.split("/"));
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: peer, main: "index.js" }));
      writeFileSync(join(pkg, "index.js"), `throw new Error("${peer} failed to initialise");\n`);
    }
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

/** What a missing `peer` looks like from the fixture. */
const missing = (peer: string) => ({
  threw: "OptionalPeerMissingError",
  code: "E_OPTIONAL_PEER_MISSING",
  peer,
  install: `bun add ${peer}`,
});

describe("panel features in an app without their optional packages", () => {
  let absent: Promise<Record<string, Record<string, unknown>>> | undefined;
  const runAbsent = () => (absent ??= runBundled(PEERS));

  it("record history throws OptionalPeerMissingError naming @zerotal/audit", async () => {
    const { history } = await runAbsent();
    expect(history).toMatchObject(missing("@zerotal/audit"));
    expect(history!.message).toContain("static history = true");
  }, 60_000);

  it("dispatchImport throws OptionalPeerMissingError naming @zerotal/queue", async () => {
    // It used to return false, and the caller imported inline as if no queue had been asked for.
    const { queuedImport } = await runAbsent();
    expect(queuedImport).toMatchObject(missing("@zerotal/queue"));
    expect(queuedImport!.message).toContain("importAction({ queue: true })");
  }, 60_000);

  it("the database notifications provider throws OptionalPeerMissingError", async () => {
    const { notifications } = await runAbsent();
    expect(notifications).toMatchObject(missing("@zerotal/notifications"));
    expect(notifications!.message).toContain("databaseNotifications()");
  }, 60_000);
});

describe("panel features with optional packages that fail while loading", () => {
  it("rethrows a broken audit or queue package, rather than calling it missing", async () => {
    const { history, queuedImport, notifications } = await runBundled(PEERS, true);
    expect(history).toMatchObject({
      threw: "Error",
      message: "@zerotal/audit failed to initialise",
    });
    expect(queuedImport).toMatchObject({
      threw: "Error",
      message: "@zerotal/queue failed to initialise",
    });
    // The bell fails soft on anything but a missing package: it logs and shows nothing.
    expect(notifications).toEqual({ returned: [] });
  }, 60_000);
});

describe("panel features with their optional packages bundled", () => {
  it("embeds them, so a compiled app finds them with nothing installed", async () => {
    // Each package answers for itself: no audit table, no queue driver, no notifications table.
    const result = await runBundled([]);
    expect(result).toEqual({
      history: { returned: [] },
      queuedImport: { returned: false },
      notifications: { returned: [] },
    });
  }, 60_000);
});
