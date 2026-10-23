import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Command } from "../Command.ts";
import { CommandRunner } from "../CommandRunner.ts";
import { Application } from "../../application/Application.ts";
import { TestCommand } from "./TestCommand.ts";

/**
 * `zt test a.test.ts b.test.ts` ran only `a`. The parser keeps the positionals a command
 * declares and drops the rest, `zt test` declares one, and the result was a green run for a
 * file that had not run: the count of tests in the output was the only sign.
 */
class EchoRestCommand extends Command {
  static commandName = "echo:rest";
  static description = "Records what it was given";
  static needsApp = false;
  static args = [{ name: "first", required: false }];
  static flags = [{ name: "loud", type: "boolean" as const, default: false }];
  static seen: { first: string | undefined; rest: string[] } = { first: undefined, rest: [] };

  async run(): Promise<void> {
    EchoRestCommand.seen = { first: this.args["first"], rest: this.rest };
  }
}

describe("Command.rest", () => {
  beforeEach(() => Application._resetInstance());
  afterEach(() => Application._resetInstance());

  async function run(argv: string[]) {
    Application._resetInstance(); // one app per call; a test may make several
    const app = Application.create({ env: "test" });
    await app.boot();
    const runner = new CommandRunner(app);
    runner.register(EchoRestCommand);
    await runner.callInProcess(["echo:rest", ...argv]);
    return EchoRestCommand.seen;
  }

  it("holds the positionals beyond the declared ones, in order", async () => {
    expect(await run(["a", "b", "c"])).toEqual({ first: "a", rest: ["b", "c"] });
  });

  it("is empty when nothing extra was given", async () => {
    expect(await run(["a"])).toEqual({ first: "a", rest: [] });
    expect(await run([])).toEqual({ first: "", rest: [] });
  });

  it("does not include flags or their values", async () => {
    expect(await run(["a", "--loud", "b"])).toEqual({ first: "a", rest: ["b"] });
  });
});

describe("zt test with several paths", () => {
  let spawned: string[][] = [];
  const originalSpawn = Bun.spawn;

  beforeEach(() => {
    spawned = [];
    (Bun as unknown as { spawn: unknown }).spawn = (argv: string[]) => {
      spawned.push(argv);
      return { exited: Promise.resolve(0) };
    };
  });

  afterEach(() => {
    (Bun as unknown as { spawn: unknown }).spawn = originalSpawn;
  });

  async function bunArgsFor(pattern: string, rest: string[]): Promise<string[]> {
    const command = new TestCommand();
    command.args = { pattern };
    command.rest = rest;
    command.flags = {};
    command._writer = { write: () => {}, writeLine: () => {}, writeError: () => {} };
    await command.run();
    return spawned[0]!.slice(1); // drop the bun binary
  }

  it("passes every path to bun test", async () => {
    const args = await bunArgsFor("tests/a.test.ts", ["tests/b.test.ts", "tests/c.test.ts"]);

    expect(args).toContain("tests/a.test.ts");
    expect(args).toContain("tests/b.test.ts");
    expect(args).toContain("tests/c.test.ts");
    expect(args.indexOf("tests/a.test.ts")).toBeLessThan(args.indexOf("tests/b.test.ts"));
  });

  it("still passes one path, and none", async () => {
    const one = await bunArgsFor("tests/a.test.ts", []);
    expect(one.filter((arg) => arg.endsWith(".test.ts"))).toEqual(["tests/a.test.ts"]);

    spawned = [];
    const none = await bunArgsFor("", []);
    expect(none.filter((arg) => arg.endsWith(".test.ts"))).toEqual([]);
  });
});
