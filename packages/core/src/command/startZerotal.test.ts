import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `zt list`, `zt help <command>` and `zt <command> --help` print and return. Commands that do
 * work end the process themselves, so these were the only ones left to wind down on their own,
 * and in an app holding anything open (a database connection, the dev tools) they never did:
 * the page printed, then the terminal sat there until Ctrl+C.
 *
 * Each case runs a real process, because "the process did not exit" is not something a function
 * call can show.
 */

const CORE_ENTRY = pathToFileURL(join(import.meta.dir, "..", "index.ts")).href;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "zt-start-"));
  await mkdir(join(dir, "config"));
  await writeFile(
    join(dir, "zt.ts"),
    `import { startZerotal, Application } from ${JSON.stringify(CORE_ENTRY)};

// Something that stays open for as long as the process lives, as a connection or a watcher would.
setInterval(() => {}, 60_000);

await startZerotal(async () => ({ default: Application.create({ env: "console" }) }));
`,
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Run `bun zt.ts <args>` in the fixture app; give up on it after `limitMs`. */
async function zt(
  args: string[],
  limitMs = 20_000,
): Promise<{ code: number | null; out: string; hung: boolean }> {
  const proc = Bun.spawn([process.execPath, "zt.ts", ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, APP_ENV: "console" },
  });
  let hung = false;
  const timer = setTimeout(() => {
    hung = true;
    proc.kill();
  }, limitMs);
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code: hung ? null : code, out: out + err, hung };
}

describe("the CLI exits after it has only printed", () => {
  it("zt list lists the commands and exits", async () => {
    const result = await zt(["list"]);

    expect(result.hung).toBe(false);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Available commands:");
  });

  it("zt help <command> prints the page and exits", async () => {
    const result = await zt(["help", "route:list"]);

    expect(result.hung).toBe(false);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Usage:");
  });

  it("zt <command> --help prints the page and exits, without running the command", async () => {
    const result = await zt(["route:list", "--help"]);

    expect(result.hung).toBe(false);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Usage:");
    expect(result.out).not.toContain("No routes");
  });

  it("a command that does run still exits with its own status", async () => {
    // Guards the other direction: exiting here must not disturb a command's exit code.
    const result = await zt(["no:such:command"]);

    expect(result.hung).toBe(false);
    expect(result.code).toBe(1);
    expect(result.out).toContain("Unknown command");
  });
});
