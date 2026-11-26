import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestCommand } from "./TestCommand.ts";

/**
 * One run of a starter's suite printed 397 log lines, nearly all of them the request line
 * the logger writes for every request a test makes. `zt test` now hands its child
 * `LOG_LEVEL=warn` unless something more specific sets it.
 */
describe("zt test's log level", () => {
  const originalSpawn = Bun.spawn;
  const originalCwd = process.cwd();
  const originalLevel = Bun.env["LOG_LEVEL"];
  let env: Record<string, string | undefined> = {};
  let lines: string[] = [];
  let dir: string;

  beforeEach(async () => {
    // An empty project, so no `.env` on this machine decides the answer.
    dir = await mkdtemp(join(tmpdir(), "zerotal-test-loglevel-"));
    process.chdir(dir);
    delete Bun.env["LOG_LEVEL"];
    env = {};
    lines = [];
    (Bun as unknown as { spawn: unknown }).spawn = (
      _argv: string[],
      options: { env: Record<string, string | undefined> },
    ) => {
      env = options.env;
      return { exited: Promise.resolve(0) };
    };
  });

  afterEach(async () => {
    (Bun as unknown as { spawn: unknown }).spawn = originalSpawn;
    process.chdir(originalCwd);
    if (originalLevel === undefined) delete Bun.env["LOG_LEVEL"];
    else Bun.env["LOG_LEVEL"] = originalLevel;
    await rm(dir, { recursive: true, force: true });
  });

  async function run(flags: Record<string, string | boolean | number> = {}): Promise<void> {
    const command = new TestCommand();
    command.args = { pattern: "" };
    command.rest = [];
    command.flags = flags;
    command.unknownFlags = [];
    command._writer = {
      write: () => {},
      writeLine: (line: string) => lines.push(line),
      writeError: (line: string) => lines.push(line),
    };
    await command.run();
  }

  it("gives the spawned suite LOG_LEVEL=warn by default", async () => {
    await run();

    expect(env["LOG_LEVEL"]).toBe("warn");
  });

  it("says so in the line it prints before the run", async () => {
    await run();

    expect(lines.join("\n")).toContain("LOG_LEVEL=warn");
  });

  it("keeps a LOG_LEVEL set in the shell", async () => {
    Bun.env["LOG_LEVEL"] = "debug";

    await run();

    expect(env["LOG_LEVEL"]).toBe("debug");
  });

  it("takes LOG_LEVEL from .env.test", async () => {
    await Bun.write(join(dir, ".env.test"), "LOG_LEVEL=info\n");

    await run();

    expect(env["LOG_LEVEL"]).toBe("info");
  });

  it("still defaults to warn under --keep-env", async () => {
    await run({ "keep-env": true });

    expect(env["LOG_LEVEL"]).toBe("warn");
  });
});
