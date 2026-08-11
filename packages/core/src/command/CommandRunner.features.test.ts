import { describe, it, expect, beforeEach } from "bun:test";
import { relative } from "node:path";
import { CommandRunner, parseSignature } from "./CommandRunner.ts";
import { Application } from "../application/Application.ts";

/**
 * The fixture directory, expressed the way `app.conventions.paths.commands`
 * expects it: relative to the current working directory.
 *
 * Hard-coding `"src/command/__fixtures__"` only works when cwd happens to be
 * `packages/core`, which is true under `bun --filter='*' run test` and false for
 * a plain `bun test` at the repo root — so the suite went red depending on how
 * it was invoked. Deriving it from this file's own location makes the test say
 * what it means regardless of where it runs from.
 */
const FIXTURE_COMMANDS_DIR = relative(process.cwd(), `${import.meta.dir}/__fixtures__`)
  .split("\\")
  .join("/");

function runner(): CommandRunner {
  Application._resetInstance();
  const app = Application.create({ env: "test" });
  return new CommandRunner(app);
}

beforeEach(() => {
  Application._resetInstance();
});

describe("parseSignature()", () => {
  it("splits name, required/optional args and flags", () => {
    const { name, args, flags } = parseSignature("greet {name} {title?} {--loud} {--lang=en}");
    expect(name).toBe("greet");
    expect(args).toEqual([
      { name: "name", required: true },
      { name: "title", required: false },
    ]);
    expect(flags).toEqual([
      { name: "loud", type: "boolean", default: false },
      { name: "lang", type: "string", default: "en" },
    ]);
  });
  it("supports default values on positional args", () => {
    const { args } = parseSignature("make {env=production}");
    expect(args).toEqual([{ name: "env", required: false, default: "production" }]);
  });
});

describe("closure commands", () => {
  it("registers and runs a closure via callInProcess", async () => {
    const r = runner();
    r.command({
      signature: "greet {name} {--loud}",
      description: "Say hello",
      handle: ({ name, loud }, cmd) => {
        cmd.info(loud ? `HELLO ${name}!` : `Hello, ${name}`);
      },
    });
    const plain = await r.callInProcess(["greet", "Sam"]);
    expect(plain.code).toBe(0);
    expect(plain.output).toContain("Hello, Sam");
    const loud = await r.callInProcess(["greet", "Sam", "--loud"]);
    expect(loud.output).toContain("HELLO Sam!");
  });
  it("registerCommand is an alias of command", async () => {
    const r = runner();
    r.registerCommand({ signature: "ping", handle: (_p, cmd) => cmd.info("pong") });
    const res = await r.callInProcess(["ping"]);
    expect(res.output).toContain("pong");
  });
});

describe("discover()", () => {
  it("finds and registers Command subclasses in a directory", async () => {
    const r = runner();
    const names = await r.discover(`${import.meta.dir}/__fixtures__`);
    expect(names).toContain("greet:fixture");
    const res = await r.callInProcess(["greet:fixture"]);
    expect(res.output).toContain("discovered");
  });
  it("returns an empty array for a missing directory", async () => {
    const r = runner();
    const names = await r.discover(`${import.meta.dir}/__does_not_exist__`);
    expect(names).toEqual([]);
  });
});

describe("boot() app-command discovery", () => {
  // `discover()` is a public method on a plain class, so an own-property assignment
  // shadows it — the spy sees exactly the directory boot() resolves.
  function spyOnDiscover(r: CommandRunner): { dirs: string[] } {
    const seen = { dirs: [] as string[] };
    (r as unknown as { discover: (dir: string) => Promise<string[]> }).discover = async (
      dir: string,
    ) => {
      seen.dirs.push(dir);
      return [];
    };
    return seen;
  }

  it("discovers app/commands under the app root by default", async () => {
    Application._resetInstance();
    const app = Application.create({ env: "test" });
    app.useConfig({ app: { name: "T" } });
    const r = new CommandRunner(app);
    const seen = spyOnDiscover(r);
    await r.boot();
    expect(seen.dirs).toEqual([`${process.cwd()}/app/commands`]);
  });

  it("respects a conventions.paths.commands override", async () => {
    Application._resetInstance();
    const app = Application.create({ env: "test" });
    app.useConfig({ app: { conventions: { paths: { commands: "src/cli" } } } });
    const r = new CommandRunner(app);
    const seen = spyOnDiscover(r);
    await r.boot();
    expect(seen.dirs).toEqual([`${process.cwd()}/src/cli`]);
  });

  it("does not discover when conventions are disabled", async () => {
    Application._resetInstance();
    const app = Application.create({ env: "test" });
    app.useConfig({ app: { conventions: { enabled: false } } });
    const r = new CommandRunner(app);
    const seen = spyOnDiscover(r);
    await r.boot();
    expect(seen.dirs).toEqual([]);
  });

  it("a discovered command actually runs end to end", async () => {
    Application._resetInstance();
    const app = Application.create({ env: "test" });
    app.useConfig({
      app: { conventions: { paths: { commands: FIXTURE_COMMANDS_DIR } } },
    });
    const r = new CommandRunner(app);
    await r.boot();
    const res = await r.callInProcess(["greet:fixture"]);
    expect(res.output).toContain("discovered");
  });
});

describe("list output with descriptions", () => {
  it("prints command names alongside their descriptions", async () => {
    const r = runner();
    r.command({ signature: "greet {name}", description: "Say hello to someone" });
    let out = "";
    const orig = console.log;
    console.log = (...a: unknown[]) => {
      out += a.map(String).join(" ") + "\n";
    };
    try {
      await r.run(["list"]);
    } finally {
      console.log = orig;
    }
    expect(out).toContain("greet");
    expect(out).toContain("Say hello to someone");
  });
});

describe("help <command>", () => {
  it("prints usage, description, arguments and options", async () => {
    const r = runner();
    r.command({ signature: "greet {name} {--loud}", description: "Greet a person" });
    let out = "";
    const orig = console.log;
    console.log = (...a: unknown[]) => {
      out += a.map(String).join(" ") + "\n";
    };
    try {
      await r.run(["help", "greet"]);
    } finally {
      console.log = orig;
    }
    expect(out).toContain("Usage:");
    expect(out).toContain("greet");
    expect(out).toContain("<name>");
    expect(out).toContain("Greet a person");
    expect(out).toContain("--loud");
  });
  it("reports an unknown command", async () => {
    const r = runner();
    let err = "";
    const orig = console.error;
    console.error = (...a: unknown[]) => {
      err += a.map(String).join(" ") + "\n";
    };
    try {
      await r.run(["help", "nope"]);
    } finally {
      console.error = orig;
    }
    expect(err).toContain("Unknown command");
  });
});
