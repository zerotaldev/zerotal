import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Command } from "../Command.ts";
import { CommandRunner } from "../CommandRunner.ts";
import { Application } from "../../application/Application.ts";
import { TestCommand } from "./TestCommand.ts";

/**
 * `zt test --isolate tests/smoke.test.ts` ran normally, printed nothing, and had no effect: the
 * parser drops an option the command does not declare, and `zt test` did not declare it. Bun can
 * run each test file in a fresh global, which is what makes a result independent of file order,
 * and the only way to ask for it through `zt test` was a flag that was thrown away.
 */
class RecordsFlagsCommand extends Command {
  static commandName = "records:flags";
  static description = "Records what it was given";
  static needsApp = false;
  static flags = [{ name: "loud", short: "l", type: "boolean" as const, default: false }];
  static seen: string[] = [];

  async run(): Promise<void> {
    RecordsFlagsCommand.seen = this.unknownFlags;
  }
}

describe("Command.unknownFlags", () => {
  beforeEach(() => Application._resetInstance());
  afterEach(() => Application._resetInstance());

  async function run(argv: string[]): Promise<string[]> {
    const app = Application.create({ env: "test" });
    await app.boot();
    const runner = new CommandRunner(app);
    runner.register(RecordsFlagsCommand);
    await runner.callInProcess(["records:flags", ...argv]);
    return RecordsFlagsCommand.seen;
  }

  it("lists an option the command does not declare", async () => {
    expect(await run(["--isolate"])).toEqual(["--isolate"]);
  });

  it("lists a short option and a long one with a value, by name", async () => {
    expect(await run(["-x", "--shard=1/3"])).toEqual(["-x", "--shard"]);
  });

  it("does not list a declared option, long or short", async () => {
    expect(await run(["--loud", "-l"])).toEqual([]);
  });

  it("is empty when nothing unusual was typed", async () => {
    expect(await run([])).toEqual([]);
  });
});

describe("zt test options", () => {
  let spawned: string[][] = [];
  let lines: string[] = [];
  let errors: string[] = [];
  const originalSpawn = Bun.spawn;

  beforeEach(() => {
    spawned = [];
    lines = [];
    errors = [];
    process.exitCode = 0;
    (Bun as unknown as { spawn: unknown }).spawn = (argv: string[]) => {
      spawned.push(argv);
      return { exited: Promise.resolve(0) };
    };
  });

  afterEach(() => {
    (Bun as unknown as { spawn: unknown }).spawn = originalSpawn;
    process.exitCode = 0;
  });

  async function run(
    flags: Record<string, string | boolean | number>,
    unknownFlags: string[] = [],
    rest: string[] = [],
  ): Promise<string[] | undefined> {
    const command = new TestCommand();
    command.args = { pattern: "" };
    command.rest = rest;
    command.flags = flags;
    command.unknownFlags = unknownFlags;
    command._writer = {
      write: () => {},
      writeLine: (line: string) => lines.push(line),
      writeError: (line: string) => errors.push(line),
    };
    await command.run();
    return spawned[0]?.slice(1);
  }

  it("passes --isolate to bun test", async () => {
    expect(await run({ isolate: true })).toContain("--isolate");
  });

  it("leaves isolation off unless it is asked for", async () => {
    expect(await run({})).not.toContain("--isolate");
  });

  it("hands --shard and --parallel to bun test when they come after --", async () => {
    const args = await run({}, [], ["--shard=2/3", "--parallel=4"]);

    expect(args).toContain("--shard=2/3");
    expect(args).toContain("--parallel=4");
  });

  it("refuses an option it does not know, and does not run the suite", async () => {
    const args = await run({}, ["--coverge"]);

    expect(args).toBeUndefined();
    expect(process.exitCode).toBe(1);
    const message = errors.concat(lines).join("\n");
    expect(message).toContain("--coverge");
    expect(message).toContain("--isolate");
    expect(message).toContain("zt test -- --coverge");
  });

  it("forwards what follows -- untouched, which is how any other bun test flag gets through", async () => {
    const args = await run({}, [], ["--rerun-each=3"]);

    expect(args).toContain("--rerun-each=3");
  });
});
