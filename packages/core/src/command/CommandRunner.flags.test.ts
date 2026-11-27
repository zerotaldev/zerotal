/**
 * An option a command does not declare is refused, naming the one it most likely meant.
 *
 * The parser used to drop it without a word, so `route:list --json` printed the table,
 * `make:controller X --dry-run` wrote the file, and both exited 0. A command that hands options on
 * to another tool (`zt test`) says so with `allowUnknownFlags`, and a bare `--` still ends the
 * options for every command.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "./Command.ts";
import type { FlagDef } from "./Command.ts";
import { CommandRunner, _declaredFlags, _nearestFlag, _wantsJson } from "./CommandRunner.ts";
import { Application } from "../application/Application.ts";

class RecordsCommand extends Command {
  static override commandName = "records";
  static override description = "Records what it was given";
  static override needsApp = false;
  static override args = [{ name: "target", required: false }];
  static override flags: FlagDef[] = [
    { name: "json", type: "boolean", default: false },
    { name: "verbose", short: "v", type: "boolean", default: false },
    { name: "method", short: "m", type: "string" },
  ];
  static ran = 0;
  static seen:
    { args: Record<string, string>; flags: Record<string, unknown>; rest: string[] } | undefined;

  async run(): Promise<void> {
    RecordsCommand.ran++;
    RecordsCommand.seen = { args: this.args, flags: this.flags, rest: this.rest };
  }
}

class PassesThroughCommand extends RecordsCommand {
  static override commandName = "passes";
  static override allowUnknownFlags = true;
  static unknown: string[] = [];

  override async run(): Promise<void> {
    PassesThroughCommand.unknown = this.unknownFlags;
  }
}

abstract class SharesFlags extends Command {
  static override sharedFlags: FlagDef[] = [
    { name: "dry-run", type: "boolean", default: false },
    { name: "loud", short: "v", type: "boolean", default: false },
  ];
}

class InheritsCommand extends SharesFlags {
  static override commandName = "inherits";
  static override description = "Takes its base's flags";
  static override needsApp = false;
  static override flags: FlagDef[] = [{ name: "verbose", short: "v", type: "boolean" }];
  static seen: Record<string, unknown> = {};

  async run(): Promise<void> {
    InheritsCommand.seen = this.flags;
  }
}

let runner: CommandRunner;

beforeEach(async () => {
  Application._resetInstance();
  const app = Application.create({ env: "test" });
  await app.boot();
  runner = new CommandRunner(app);
  runner.registerAll([RecordsCommand, PassesThroughCommand, InheritsCommand]);
  RecordsCommand.ran = 0;
  RecordsCommand.seen = undefined;
});
afterEach(() => Application._resetInstance());

describe("an option the command does not declare", () => {
  it("is refused, and the command does not run", async () => {
    const result = await runner.callInProcess(["records", "--dry-run"]);

    expect(result.code).toBe(1);
    expect(RecordsCommand.ran).toBe(0);
    expect(result.output).toContain("records does not take --dry-run.");
    expect(result.output).toContain("Its options: --json, --verbose (-v), --method (-m).");
    expect(result.output).toContain("See: bun zt help records");
  });

  it("names the declared option a typo meant", async () => {
    for (const [typed, meant] of [
      ["--jsn", "--json"],
      ["--verbsoe", "--verbose"],
      ["--verb", "--verbose"],
      ["--metod=GET", "--method"],
      ["-V", "-v"],
    ]) {
      const result = await runner.callInProcess(["records", typed!]);
      expect(result.code).toBe(1);
      expect(result.output).toContain(`Did you mean ${meant}?`);
    }
    expect(RecordsCommand.ran).toBe(0);
  });

  it("suggests nothing when nothing is close", async () => {
    const result = await runner.callInProcess(["records", "--coverage"]);
    expect(result.code).toBe(1);
    expect(result.output).not.toContain("Did you mean");
  });

  it("lists every unknown option typed, as typed", async () => {
    const result = await runner.callInProcess(["records", "-x", "--shard=1/3", "--json"]);
    expect(result.code).toBe(1);
    expect(result.output).toContain("records does not take -x, --shard.");
  });

  it("is not refused after a bare --, where it is an operand", async () => {
    const result = await runner.callInProcess(["records", "--", "--dry-run", "--x"]);
    expect(result.code).toBe(0);
    expect(RecordsCommand.seen?.args).toEqual({ target: "--dry-run" });
    expect(RecordsCommand.seen?.rest).toEqual(["--x"]);
  });

  it("is handed to a command that takes free options, which decides", async () => {
    const result = await runner.callInProcess(["passes", "--isolate", "-x", "--json"]);
    expect(result.code).toBe(0);
    expect(PassesThroughCommand.unknown).toEqual(["--isolate", "-x"]);
  });

  it("leaves a declared option, long or short, alone", async () => {
    const result = await runner.callInProcess(["records", "--json", "-v", "-m", "GET"]);
    expect(result.code).toBe(0);
    expect(RecordsCommand.seen?.flags).toMatchObject({ json: true, verbose: true, method: "GET" });
  });

  it("still lets --help through, which prints the page and runs nothing", async () => {
    // `_wantsHelp` answers before anything is parsed, so `--help` is never an unknown option.
    const { _wantsHelp } = await import("./CommandRunner.ts");
    expect(_wantsHelp(RecordsCommand, ["--help"])).toBe(true);
  });
});

describe("flags a base class shares", () => {
  it("are taken by every subclass, after its own", async () => {
    const result = await runner.callInProcess(["inherits", "--dry-run", "-v"]);
    expect(result.code).toBe(0);
    expect(InheritsCommand.seen).toMatchObject({ "dry-run": true, verbose: true, loud: false });
  });

  it("give way to the subclass's own name and short letter", () => {
    expect(_declaredFlags(InheritsCommand).map((flag) => [flag.name, flag.short])).toEqual([
      ["verbose", "v"],
      ["dry-run", undefined],
      ["loud", undefined],
    ]);
  });
});

describe("_nearestFlag()", () => {
  const flags: FlagDef[] = [
    { name: "dry-run", type: "boolean" },
    { name: "force", type: "boolean" },
    { name: "resource", type: "boolean" },
  ];

  it("reads a missing dash, a plural and a prefix", () => {
    expect(_nearestFlag("--dryrun", flags)).toBe("--dry-run");
    expect(_nearestFlag("--resources", flags)).toBe("--resource");
    expect(_nearestFlag("--forc", flags)).toBe("--force");
  });

  it("says nothing rather than guess far", () => {
    expect(_nearestFlag("--model", flags)).toBeUndefined();
    expect(_nearestFlag("-x", flags)).toBeUndefined();
  });
});

describe("_wantsJson()", () => {
  it("is true only for a command that declares --json, and only before --", () => {
    expect(_wantsJson(RecordsCommand, ["--json"])).toBe(true);
    expect(_wantsJson(RecordsCommand, ["--", "--json"])).toBe(false);
    expect(_wantsJson(InheritsCommand, ["--json"])).toBe(false);
  });

  it("reads the short letter a command gives --json", () => {
    const Short = { flags: [{ name: "json", short: "j", type: "boolean" as const }] };
    expect(_wantsJson(Short, ["-j"])).toBe(true);
  });
});
