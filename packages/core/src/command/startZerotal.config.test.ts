import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `zt inertia:build` declares that it does not boot the app, and still printed a red ConfigError
 * for the `APP_KEY` that `config/app.ts` requires, in a CI job that went on to succeed. People
 * read the red block as something to fix, and the fix they found was a placeholder secret in the
 * build step. A command that boots the app still gets the error, because it reads that config.
 *
 * Real processes, because the order is the subject: config is loaded before the command is known.
 */
const CORE_ENTRY = pathToFileURL(join(import.meta.dir, "..", "index.ts")).href;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "zt-config-"));
  await mkdir(join(dir, "config"));
  // What every starter's config/app.ts does with a required variable that is not set.
  await writeFile(
    join(dir, "config", "app.ts"),
    `throw new Error('Required environment variable "APP_KEY" is not set.');\n`,
  );
  await writeFile(join(dir, "config", "inertia.ts"), `export default { pagesDir: "pages" };\n`);
  await writeFile(
    join(dir, "zt.ts"),
    `import { startZerotal, Application } from ${JSON.stringify(CORE_ENTRY)};
await startZerotal(async () => ({ default: Application.create({ env: "console" }) }));
`,
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function zt(args: string[]): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn([process.execPath, "zt.ts", ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, APP_ENV: "console", APP_KEY: "" },
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out: out + err };
}

describe("a config file that fails to load", () => {
  it("is not an error for a command that does not boot the app", async () => {
    const result = await zt(["version"]);

    expect(result.code).toBe(0);
    expect(result.out).not.toContain("ERROR");
    expect(result.out).not.toContain("failed to load");
  });

  it("is still named, in one line, for a command that does not boot the app", async () => {
    const result = await zt(["version"]);

    expect(result.out).toContain('Config "app.ts" did not load');
    expect(result.out).toContain("APP_KEY");
  });

  it("is still an error for a command that boots the app", async () => {
    const result = await zt(["route:list"]);

    expect(result.out).toContain('Config "app.ts" failed to load');
    expect(result.out).toContain("APP_KEY");
  });
});
