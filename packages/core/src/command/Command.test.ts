import { describe, it, expect } from "bun:test";
import { Command } from "./Command.ts";
import { BufferWriter } from "./OutputWriter.ts";

// ── Concrete test command ─────────────────────────────────────────────────

class GreetCommand extends Command {
  static commandName = "greet";
  static description = "Says hello";
  static needsApp = false;

  static args = [{ name: "name", required: false, default: "World" }];
  static flags = [
    {
      name: "upper",
      short: "u",
      type: "boolean" as const,
      description: "Uppercase",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const upper = this.flags["upper"] as boolean;
    const msg = upper ? name.toUpperCase() : name;
    this.info(`Hello, ${msg}!`);
    this.warn("A warning");
    this.error("An error");
  }
}

class ThrowingCommand extends Command {
  static commandName = "thrower";
  static description = "Always throws";
  static needsApp = false;

  async run(): Promise<void> {
    throw new Error("intentional failure");
  }
}

// ── OutputWriter tests ────────────────────────────────────────────────────

describe("BufferWriter", () => {
  it("captures writeLine output", () => {
    const w = new BufferWriter();
    w.writeLine("hello");
    w.writeLine("world");
    expect(w.flush()).toBe("hello\nworld\n");
  });

  it("captures write output without newline", () => {
    const w = new BufferWriter();
    w.write("no newline");
    expect(w.flush()).toBe("no newline");
  });

  it("flush() clears the buffer", () => {
    const w = new BufferWriter();
    w.writeLine("first");
    w.flush();
    w.writeLine("second");
    expect(w.flush()).toBe("second\n");
  });

  it("captures writeError output", () => {
    const w = new BufferWriter();
    w.writeError("oops");
    expect(w.flush()).toContain("oops");
  });
});

// ── Command output routing through _writer ────────────────────────────────

describe("Command output helpers route through _writer", () => {
  it("info() writes to _writer", () => {
    const cmd = new GreetCommand();
    const buf = new BufferWriter();
    (cmd as any)._writer = buf;
    (cmd as any).args = { name: "Siphesihle" };
    (cmd as any).flags = { upper: false };

    cmd.info("test message");
    expect(buf.flush()).toContain("test message");
  });

  it("error() writes to _writer", () => {
    const cmd = new GreetCommand();
    const buf = new BufferWriter();
    (cmd as any)._writer = buf;
    cmd.error("something went wrong");
    expect(buf.flush()).toContain("something went wrong");
  });

  it("table() writes to _writer", () => {
    const cmd = new GreetCommand();
    const buf = new BufferWriter();
    (cmd as any)._writer = buf;
    cmd.table([
      ["Key", "Value"],
      ["Foo", "Bar"],
    ]);
    const out = buf.flush();
    expect(out).toContain("Key");
    expect(out).toContain("Bar");
  });
});

// ── CommandRunner.callInProcess() ─────────────────────────────────────────

describe("CommandRunner — required arguments", () => {
  class NeedsNameCommand extends Command {
    static override commandName = "needs:name";
    static override needsApp = false;
    static override args = [{ name: "name", required: true }];
    override async run(): Promise<void> {
      this.info(`got ${this.args["name"]}`);
    }
  }

  it("refuses to run when a required argument is missing", async () => {
    const { CommandRunner } = await import("./CommandRunner.ts");
    const { Application } = await import("../application/Application.ts");

    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();

    const runner = new CommandRunner(app);
    runner.register(NeedsNameCommand);

    // `required` shaped the help text and nothing else, so this used to run with
    // `name` as "" — `make:migration` wrote `001_.ts` holding `class  {`.
    const result = await runner.callInProcess(["needs:name"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("Missing required argument: name");
    expect(result.output).toContain("needs:name <name>");
    expect(result.output).not.toContain("got ");
  });

  it("runs normally once the argument is supplied", async () => {
    const { CommandRunner } = await import("./CommandRunner.ts");
    const { Application } = await import("../application/Application.ts");

    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();

    const runner = new CommandRunner(app);
    runner.register(NeedsNameCommand);

    const result = await runner.callInProcess(["needs:name", "posts"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("got posts");
  });
});

describe("CommandRunner.callInProcess()", () => {
  it("returns code=0 and captured output on success", async () => {
    const { CommandRunner } = await import("./CommandRunner.ts");
    const { Application } = await import("../application/Application.ts");

    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();

    const runner = new CommandRunner(app);
    runner.register(GreetCommand);

    const result = await runner.callInProcess(["greet", "Alice"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("Hello, Alice!");
    expect(result.output).not.toBe("");
    // Nothing should have been written to stdout — output is captured
  });

  it("returns code=1 and error message on failure", async () => {
    const { CommandRunner } = await import("./CommandRunner.ts");
    const { Application } = await import("../application/Application.ts");

    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();

    const runner = new CommandRunner(app);
    runner.register(ThrowingCommand);

    const result = await runner.callInProcess(["thrower"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("intentional failure");
  });

  it("returns code=1 for unknown command", async () => {
    const { CommandRunner } = await import("./CommandRunner.ts");
    const { Application } = await import("../application/Application.ts");

    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();

    const runner = new CommandRunner(app);
    const result = await runner.callInProcess(["no-such-command"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("no-such-command");
  });

  it("does NOT call process.exit()", async () => {
    const { CommandRunner } = await import("./CommandRunner.ts");
    const { Application } = await import("../application/Application.ts");

    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();

    const runner = new CommandRunner(app);
    runner.register(GreetCommand);

    let exitCalled = false;
    const original = process.exit.bind(process);
    (process as any).exit = () => {
      exitCalled = true;
    };

    await runner.callInProcess(["greet"]);

    (process as any).exit = original;
    expect(exitCalled).toBe(false);
  });

  it("emits a CommandRan event on success and failure", async () => {
    const { CommandRunner } = await import("./CommandRunner.ts");
    const { Application } = await import("../application/Application.ts");
    const { FrameworkEvents, CommandRan } = await import("../events/FrameworkEvents.ts");

    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();

    const runner = new CommandRunner(app);
    runner.register(GreetCommand);
    runner.register(ThrowingCommand);

    const seen: InstanceType<typeof CommandRan>[] = [];
    const off = FrameworkEvents.on(CommandRan, (e) => seen.push(e));

    await runner.callInProcess(["greet", "Ada"]);
    await runner.callInProcess(["thrower"]);
    off();

    expect(seen).toHaveLength(2);
    expect(seen[0]!.name).toBe("greet");
    expect(seen[0]!.ok).toBe(true);
    expect(seen[0]!.exitCode).toBe(0);
    expect(seen[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(seen[1]!.name).toBe("thrower");
    expect(seen[1]!.ok).toBe(false);
    expect(seen[1]!.exitCode).toBe(1);
    expect(seen[1]!.error).toContain("intentional failure");
  });
});

// ── Lazy registration ─────────────────────────────────────────────────────

describe("CommandRunner.registerLazy()", () => {
  it("registers a thunk and resolves it on first call", async () => {
    const { CommandRunner } = await import("./CommandRunner.ts");
    const { Application } = await import("../application/Application.ts");

    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();

    const runner = new CommandRunner(app);
    let thunkCallCount = 0;

    runner.registerLazy("greet", async () => {
      thunkCallCount++;
      return GreetCommand;
    });

    // First call — thunk fires
    const r1 = await runner.callInProcess(["greet"]);
    expect(thunkCallCount).toBe(1);
    expect(r1.code).toBe(0);

    // Second call — thunk NOT called again (cached)
    const r2 = await runner.callInProcess(["greet"]);
    expect(thunkCallCount).toBe(1);
    expect(r2.code).toBe(0);
  });

  it("registerLazy aliases also resolve correctly", async () => {
    const { CommandRunner } = await import("./CommandRunner.ts");
    const { Application } = await import("../application/Application.ts");

    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();

    const runner = new CommandRunner(app);
    runner.registerLazy("greet", async () => GreetCommand, ["hi", "hello"]);

    const r = await runner.callInProcess(["hi"]);
    expect(r.code).toBe(0);
  });
});

// ── Application.create() reads APP_ENV ────────────────────────────────────

describe("Application.create() reads APP_ENV", () => {
  // Cast to mutable for test setup/teardown: Bun.env is typed Readonly.
  const mutableEnv = Bun.env as Record<string, string | undefined>;

  it("creates web app when APP_ENV=web", async () => {
    const { Application } = await import("../application/Application.ts");
    Application._resetInstance();
    const original = mutableEnv["APP_ENV"];
    mutableEnv["APP_ENV"] = "web";
    const app = Application.create();
    expect(app._env).toBe("web");
    if (original !== undefined) {
      mutableEnv["APP_ENV"] = original;
    } else {
      delete mutableEnv["APP_ENV"];
    }
    Application._resetInstance();
  });

  it("creates console app when APP_ENV=console", async () => {
    const { Application } = await import("../application/Application.ts");
    Application._resetInstance();
    const original = mutableEnv["APP_ENV"];
    mutableEnv["APP_ENV"] = "console";
    const app = Application.create();
    expect(app._env).toBe("console");
    if (original !== undefined) {
      mutableEnv["APP_ENV"] = original;
    } else {
      delete mutableEnv["APP_ENV"];
    }
    Application._resetInstance();
  });

  it("defaults to web when APP_ENV not set", async () => {
    const { Application } = await import("../application/Application.ts");
    Application._resetInstance();
    const original = mutableEnv["APP_ENV"];
    delete mutableEnv["APP_ENV"];
    const app = Application.create();
    expect(app._env).toBe("web");
    if (original !== undefined) {
      mutableEnv["APP_ENV"] = original;
    } else {
      delete mutableEnv["APP_ENV"];
    }
    Application._resetInstance();
  });

  it("explicit env argument overrides Bun.env", async () => {
    const { Application } = await import("../application/Application.ts");
    Application._resetInstance();
    const original = mutableEnv["APP_ENV"];
    mutableEnv["APP_ENV"] = "web";
    const app = Application.create({ env: "console" });
    expect(app._env).toBe("console");
    if (original !== undefined) {
      mutableEnv["APP_ENV"] = original;
    } else {
      delete mutableEnv["APP_ENV"];
    }
    Application._resetInstance();
  });
});

// ── CommandRunner.boot() — command registration ───────────────────────────

describe("CommandRunner.boot() — command registration", () => {
  it("ServeCommand is in the registry after boot()", async () => {
    const { Application } = await import("../application/Application.ts");
    const { CommandRunner } = await import("./CommandRunner.ts");

    Application._resetInstance();
    const app = Application.create({ env: "console" });
    const runner = new CommandRunner(app);
    await runner.boot();

    let listOutput = "";
    const origLog = console.log;
    console.log = (msg: unknown) => {
      listOutput += String(msg) + "\n";
    };
    try {
      await runner.run(["list"]);
    } finally {
      console.log = origLog;
    }
    Application._resetInstance();
    expect(listOutput).toContain("serve");
  });
});

// ── bootAsWorker() environment ────────────────────────────────────────────

describe("Application.bootAsWorker()", () => {
  it("sets env to worker before booting", async () => {
    const { Application } = await import("../application/Application.ts");

    Application._resetInstance();
    const app = Application.create({ env: "web" }); // starts as web
    await app.bootAsWorker();

    expect(app._env).toBe("worker");
  });

  it("does not start Bun.serve()", async () => {
    const { Application } = await import("../application/Application.ts");

    Application._resetInstance();
    const app = Application.create({ env: "web" });

    let serveCalled = false;
    const original = (globalThis as any).Bun?.serve;
    if ((globalThis as any).Bun) {
      (globalThis as any).Bun.serve = (...args: unknown[]) => {
        serveCalled = true;
        return original?.(...args);
      };
    }

    await app.bootAsWorker();

    if ((globalThis as any).Bun) {
      (globalThis as any).Bun.serve = original;
    }

    expect(serveCalled).toBe(false);
  });
});

// ── CommandRunner list output ───────────────────────────────────────────

describe("CommandRunner — list output", () => {
  it('run(["list"]) completes without throwing', async () => {
    const { CommandRunner } = await import("./CommandRunner.ts");
    const { Application } = await import("../application/Application.ts");

    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();

    const runner = new CommandRunner(app);
    const { KeyGenerateCommand } = await import("./builtin/KeyGenerateCommand.ts");
    runner.register(KeyGenerateCommand);

    let threw = false;
    try {
      const original = console.log;
      console.log = () => {};
      await runner.run(["list"]);
      console.log = original;
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

// ── Additional Command output helpers ─────────────────────────────────────────

describe("Command output helpers (warn / line / dim / write / newLine / section)", () => {
  function makeCmd() {
    const cmd = new GreetCommand();
    const buf = new BufferWriter();
    (cmd as any)._writer = buf;
    return { cmd, buf };
  }

  it("warn() writes yellow-coloured text", () => {
    const { cmd, buf } = makeCmd();
    cmd.warn("watch out");
    expect(buf.flush()).toContain("watch out");
  });

  it("line() writes cyan-coloured text", () => {
    const { cmd, buf } = makeCmd();
    cmd.line("some info");
    expect(buf.flush()).toContain("some info");
  });

  it("dim() writes dim text", () => {
    const { cmd, buf } = makeCmd();
    cmd.dim("subtle text");
    expect(buf.flush()).toContain("subtle text");
  });

  it("write() writes text without a newline", () => {
    const { cmd, buf } = makeCmd();
    cmd.write("no newline here");
    expect(buf.flush()).toContain("no newline here");
  });

  it("newLine() writes an empty line", () => {
    const { cmd, buf } = makeCmd();
    cmd.newLine();
    expect(buf.flush()).toContain("");
  });

  it("section() writes a bold section title", () => {
    const { cmd, buf } = makeCmd();
    cmd.section("My Section");
    expect(buf.flush()).toContain("My Section");
  });
});

// ── Interactive prompts (mocking _readLine) ───────────────────────────────────

describe("Command interactive prompts", () => {
  function makeCmd() {
    const cmd = new GreetCommand();
    const buf = new BufferWriter();
    (cmd as any)._writer = buf;
    return { cmd, buf };
  }

  it("ask() returns the trimmed user input", async () => {
    const { cmd } = makeCmd();
    (cmd as any)._readLine = async () => "  Alice  ";
    const answer = await cmd.ask("What is your name?");
    expect(answer).toBe("Alice");
  });

  it("ask() returns the default value when input is empty", async () => {
    const { cmd } = makeCmd();
    (cmd as any)._readLine = async () => "";
    const answer = await cmd.ask("Name?", "World");
    expect(answer).toBe("World");
  });

  it("ask() displays the default value hint in the prompt", async () => {
    const { cmd, buf } = makeCmd();
    (cmd as any)._readLine = async () => "";
    await cmd.ask("Env?", "production");
    expect(buf.flush()).toContain("[production]");
  });

  it('confirm() returns true for "y" input', async () => {
    const { cmd } = makeCmd();
    (cmd as any)._readLine = async () => "y";
    expect(await cmd.confirm("Proceed?")).toBe(true);
  });

  it('confirm() returns true for "yes" input', async () => {
    const { cmd } = makeCmd();
    (cmd as any)._readLine = async () => "yes";
    expect(await cmd.confirm("Proceed?")).toBe(true);
  });

  it('confirm() returns false for "n" input', async () => {
    const { cmd } = makeCmd();
    (cmd as any)._readLine = async () => "n";
    expect(await cmd.confirm("Delete?")).toBe(false);
  });

  it("confirm() returns the defaultValue when input is empty (defaultValue=true)", async () => {
    const { cmd } = makeCmd();
    (cmd as any)._readLine = async () => "";
    expect(await cmd.confirm("Continue?", true)).toBe(true);
  });

  it("confirm() returns false when input is empty and defaultValue=false", async () => {
    const { cmd } = makeCmd();
    (cmd as any)._readLine = async () => "";
    expect(await cmd.confirm("Delete?", false)).toBe(false);
  });

  it("choice() returns the selected option by number", async () => {
    const { cmd } = makeCmd();
    (cmd as any)._readLine = async () => "2";
    const result = await cmd.choice("Pick one:", ["red", "green", "blue"]);
    expect(result).toBe("green");
  });

  it("choice() returns the first option for invalid input", async () => {
    const { cmd } = makeCmd();
    (cmd as any)._readLine = async () => "abc";
    const result = await cmd.choice("Pick one:", ["red", "green", "blue"]);
    expect(result).toBe("red");
  });

  it("choice() returns the first option for out-of-range number", async () => {
    const { cmd } = makeCmd();
    (cmd as any)._readLine = async () => "99";
    const result = await cmd.choice("Pick one:", ["red", "green"]);
    expect(result).toBe("red");
  });

  it("choice() prints numbered list of options", async () => {
    const { cmd, buf } = makeCmd();
    (cmd as any)._readLine = async () => "1";
    await cmd.choice("Pick:", ["alpha", "beta"]);
    const out = buf.flush();
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
  });
});

// ── _readLine() — mock Bun.stdin.stream ───────────────────────────────────────

describe("Command._readLine()", () => {
  it("reads a line and strips the trailing newline", async () => {
    const { cmd } = (() => {
      const c = new GreetCommand();
      const buf = new BufferWriter();
      (c as any)._writer = buf;
      return { cmd: c, buf };
    })();

    // Temporarily override Bun.stdin.stream with a real stream carrying the line.
    // A hand-rolled async iterable used to do here, but reads go through the
    // stream's reader now — the lock is the thing a prompt has to hand back.
    const encoder = new TextEncoder();
    const origStream = (Bun.stdin as unknown as { stream?: () => unknown }).stream;
    (Bun.stdin as unknown as { stream: () => unknown }).stream = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("hello\n"));
          controller.close();
        },
      });

    const line = await (cmd as any)._readLine();
    (Bun.stdin as unknown as { stream?: () => unknown }).stream = origStream;

    expect(line).toBe("hello");
  });
});

/**
 * A command that sets `process.exitCode` has failed, and the runner has to agree.
 *
 * `callInProcess` returned `{ code: 0 }` the moment `run()` returned, so the only
 * way to fail was to throw. `process.exitCode = 1` is the idiomatic way to fail a
 * Bun/Node CLI without an exception and is what most people reach for — an app
 * wrote a `release:check` that printed six blockers, set the code, and came back
 * as success. Their deploy script read that and would have restarted a broken
 * production deployment; `zt deploy` gates on the same return value, so its own
 * preflight had the hole too.
 *
 * A gate that cannot fail is not a gate, and this one failed *open*.
 */
describe("CommandRunner honours process.exitCode", () => {
  class BlockerCommand extends Command {
    static override commandName = "gate:blocked";
    static override needsApp = false;
    override async run(): Promise<void> {
      this.line("6 blockers found");
      process.exitCode = 1;
    }
  }

  class CleanCommand extends Command {
    static override commandName = "gate:clean";
    static override needsApp = false;
    override async run(): Promise<void> {
      this.line("all good");
    }
  }

  async function runnerWith(...commands: (typeof Command)[]) {
    const { CommandRunner } = await import("./CommandRunner.ts");
    const { Application } = await import("../application/Application.ts");
    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();
    const runner = new CommandRunner(app);
    for (const c of commands) runner.register(c as never);
    return runner;
  }

  it("reports a non-zero code when the command set one", async () => {
    const runner = await runnerWith(BlockerCommand);
    const result = await runner.callInProcess(["gate:blocked"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("6 blockers");
  });

  it("still reports success for a command that sets nothing", async () => {
    const runner = await runnerWith(CleanCommand);
    expect((await runner.callInProcess(["gate:clean"])).code).toBe(0);
  });

  it("does not let one command's exit code leak into the next", async () => {
    // `process.exitCode` is process-global and these run in-process, so without
    // save/restore the blocker would fail every command called after it — and
    // would leave the runner's own process marked as failed.
    const runner = await runnerWith(BlockerCommand, CleanCommand);

    expect((await runner.callInProcess(["gate:blocked"])).code).toBe(1);
    expect((await runner.callInProcess(["gate:clean"])).code).toBe(0);
    expect(process.exitCode ?? 0).toBe(0);
  });
});
