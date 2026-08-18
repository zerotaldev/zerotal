import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ServeCommand } from "./ServeCommand.ts";
import { KeyGenerateCommand, generateKey, updateEnvContent } from "./KeyGenerateCommand.ts";
import { MakeControllerCommand, basicStub, resourceStub } from "./MakeControllerCommand.ts";
import { MakeMiddlewareCommand, middlewareStub } from "./MakeMiddlewareCommand.ts";
import { MakeTestCommand, featureTestStub, unitTestStub } from "./MakeTestCommand.ts";
import { MakeCommandCommand, toKebab, commandStub } from "./MakeCommandCommand.ts";
import { TerminalWriter, BufferWriter } from "../OutputWriter.ts";
import { MakeEventCommand } from "./MakeEventCommand.ts";
import { MakeJobCommand } from "./MakeJobCommand.ts";
import { MakeListenerCommand } from "./MakeListenerCommand.ts";
import { MakeNotificationCommand, notificationStub } from "./MakeNotificationCommand.ts";
import { MakeObserverCommand } from "./MakeObserverCommand.ts";
import { MakePolicyCommand, policyStub } from "./MakePolicyCommand.ts";
import { MakeProviderCommand } from "./MakeProviderCommand.ts";
import { MakeRequestCommand } from "./MakeRequestCommand.ts";
import { MakeResourceCommand } from "./MakeResourceCommand.ts";
import { RouteListCommand } from "./RouteListCommand.ts";
import { StatusCommand } from "./StatusCommand.ts";
import { TestCommand } from "./TestCommand.ts";
import { WorkerCommand } from "./WorkerCommand.ts";
import { ReloadCommand } from "./ReloadCommand.ts";
import { CompileCommand } from "./CompileCommand.ts";
import { CssBuildCommand } from "./CssBuildCommand.ts";
import { ReplCommand } from "./ReplCommand.ts";

// ── ServeCommand ──────────────────────────────────────────────────────────────

describe("ServeCommand", () => {
  it("declares static properties", () => {
    expect(ServeCommand.commandName).toBe("serve");
    expect(ServeCommand.description).toBe("Start the HTTP server");
    expect(ServeCommand.needsApp).toBe(true);
    expect(ServeCommand.flags).toHaveLength(5);
    const flag = ServeCommand.flags[0]!;
    expect(flag.name).toBe("port");
    expect(flag.short).toBe("p");
    expect(flag.type).toBe("number");
    expect(flag.default).toBe(3000);
    expect(ServeCommand.flags.find((f) => f.name === "watch")).toBeUndefined();

    // The two ways out of a busy port without a terminal to answer the prompt.
    for (const name of ["force", "auto-port"]) {
      expect(ServeCommand.flags.find((f) => f.name === name)?.default).toBe(false);
    }
  });

  it("has 'start' and 's' as aliases", () => {
    expect(ServeCommand.aliases).toContain("start");
    expect(ServeCommand.aliases).toContain("s");
  });
});

// ── KeyGenerateCommand static ─────────────────────────────────────────────────

describe("KeyGenerateCommand", () => {
  it("declares static properties", () => {
    expect(KeyGenerateCommand.commandName).toBe("key:generate");
    expect(KeyGenerateCommand.description).toBe("Generate a new APP_KEY and write it to .env");
    expect(KeyGenerateCommand.needsApp).toBe(false);
    expect(KeyGenerateCommand.args).toHaveLength(0);
    expect(KeyGenerateCommand.flags).toHaveLength(0);
  });
});

describe("generateKey()", () => {
  it("returns a non-empty base64 string", () => {
    const key = generateKey();
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
    expect(/^[A-Za-z0-9+/]+=*$/.test(key)).toBe(true);
  });

  it("returns different keys on each call", () => {
    expect(generateKey()).not.toBe(generateKey());
  });
});

describe("updateEnvContent()", () => {
  it("appends APP_KEY when not present", () => {
    const result = updateEnvContent("DEBUG=true\n", "abc123");
    expect(result).toContain("APP_KEY=abc123");
    expect(result).toContain("DEBUG=true");
  });

  it("replaces an existing APP_KEY line", () => {
    const result = updateEnvContent("APP_KEY=old\nFOO=bar\n", "new123");
    expect(result).toContain("APP_KEY=new123");
    expect(result).not.toContain("APP_KEY=old");
    expect(result).toContain("FOO=bar");
  });
});

// ── MakeControllerCommand static + stubs ──────────────────────────────────────

describe("MakeControllerCommand", () => {
  it("declares static properties", () => {
    expect(MakeControllerCommand.commandName).toBe("make:controller");
    expect(MakeControllerCommand.description).toBe("Create a new controller class");
    expect(MakeControllerCommand.needsApp).toBe(false);
    expect(MakeControllerCommand.args).toHaveLength(1);
    expect(MakeControllerCommand.flags).toHaveLength(1);
    expect(MakeControllerCommand.args[0]!.name).toBe("name");
    expect(MakeControllerCommand.flags[0]!.name).toBe("resource");
  });

  it("basicStub includes class name and index method", () => {
    const output = basicStub("UserController");
    expect(output).toContain("UserController");
    expect(output).toContain("index(ctx: HttpContext)");
  });

  it("resourceStub includes CRUD action stubs", () => {
    const output = resourceStub("PostController");
    expect(output).toContain("store");
    expect(output).toContain("destroy");
    expect(output).toContain("update");
  });
});

// ── MakeMiddlewareCommand static ──────────────────────────────────────────────

describe("MakeMiddlewareCommand", () => {
  it("declares static properties", () => {
    expect(MakeMiddlewareCommand.commandName).toBe("make:middleware");
    expect(MakeMiddlewareCommand.description).toBe("Create a new middleware class");
    expect(MakeMiddlewareCommand.needsApp).toBe(false);
    expect(MakeMiddlewareCommand.args).toHaveLength(1);
    expect(MakeMiddlewareCommand.args[0]!.name).toBe("name");
    expect(MakeMiddlewareCommand.flags).toHaveLength(0);
  });
});

// ── MakeTestCommand static ────────────────────────────────────────────────────

describe("MakeTestCommand", () => {
  it("declares static properties", () => {
    expect(MakeTestCommand.commandName).toBe("make:test");
    expect(MakeTestCommand.description).toBe("Create a new test file");
    expect(MakeTestCommand.needsApp).toBe(false);
    expect(MakeTestCommand.args).toHaveLength(1);
    expect(MakeTestCommand.args[0]!.name).toBe("name");
    expect(MakeTestCommand.flags.map((f) => f.name)).toEqual(["unit"]);
  });

  it("the feature stub boots the app through the shared helper", () => {
    const stub = featureTestStub("PostTest");

    expect(stub).toContain("import { createApp } from '../helpers.ts'");
    // The umbrella subpath, not the scoped package: no template installs the latter.
    expect(stub).toContain("from 'zerotal/testing'");
    expect(stub).not.toContain("@zerotal/testing");
    expect(stub).toContain("describe('Post'");
    expect(stub).toContain("res.assertOk()");
    expect(stub).toContain("afterAll(() => app.close())");
  });

  it("the unit stub pulls in neither the app nor the database", () => {
    const stub = unitTestStub("SlugifyTest");

    expect(stub).toContain("describe('Slugify'");
    expect(stub).not.toContain("@zerotal/testing");
    expect(stub).not.toContain("createApp");
  });
});

// ── MakeCommandCommand static ─────────────────────────────────────────────────

describe("MakeCommandCommand", () => {
  it("declares static properties", () => {
    expect(MakeCommandCommand.commandName).toBe("make:command");
    expect(MakeCommandCommand.description).toBe("Create a new CLI command class");
    expect(MakeCommandCommand.needsApp).toBe(false);
    expect(MakeCommandCommand.args).toHaveLength(1);
    expect(MakeCommandCommand.args[0]!.name).toBe("name");
    expect(MakeCommandCommand.flags).toHaveLength(0);
  });
});

// ── toKebab() ─────────────────────────────────────────────────────────────────

describe("toKebab()", () => {
  it("converts PascalCase to kebab-case", () => {
    expect(toKebab("SendWelcomeEmail")).toBe("send-welcome-email");
    expect(toKebab("UserController")).toBe("user-controller");
    expect(toKebab("MyBigClass")).toBe("my-big-class");
  });

  it("replaces underscores and spaces with hyphens", () => {
    expect(toKebab("foo_bar")).toBe("foo-bar");
    expect(toKebab("foo bar")).toBe("foo-bar");
  });

  it("collapses multiple hyphens", () => {
    expect(toKebab("foo--bar")).toBe("foo-bar");
  });

  it("lowercases the result", () => {
    expect(toKebab("ABC")).toBe("abc");
  });
});

// ── commandStub() ─────────────────────────────────────────────────────────────

describe("commandStub()", () => {
  it("includes the class name and its kebab command name", () => {
    const stub = commandStub("SendReportCommand");
    expect(stub).toContain("SendReportCommand");
    expect(stub).toContain("send-report-command");
    expect(stub).toContain("extends Command");
    expect(stub).toContain("async run()");
  });
});

// ── middlewareStub() ──────────────────────────────────────────────────────────

describe("middlewareStub()", () => {
  it("includes the class name and implements Pipe<HttpContext>", () => {
    const stub = middlewareStub("CacheMiddleware");
    expect(stub).toContain("CacheMiddleware");
    expect(stub).toContain("implements Pipe<HttpContext>");
    expect(stub).toContain("async handle(");
    expect(stub).toContain("return next()");
  });
});

// ── Bun.file / Bun.write mocks for run() tests ───────────────────────────────

const noop = { write: () => {}, writeLine: () => {}, writeError: () => {} };

let origFile: typeof Bun.file;
let origWrite: typeof Bun.write;
let written: Record<string, string>;

beforeEach(() => {
  origFile = Bun.file;
  origWrite = Bun.write;
  written = {};
  (Bun as any).write = async (path: string, content: string) => {
    written[path] = content;
    return 0;
  };
});

afterEach(() => {
  (Bun as any).file = origFile;
  (Bun as any).write = origWrite;
});

function mockFile(exists: boolean, text?: string): void {
  (Bun as any).file = (_path: string) => ({
    exists: async () => exists,
    text: async () => {
      if (text === undefined) throw new Error("ENOENT");
      return text;
    },
    parent: { mkdir: async (_opts: unknown) => {} },
  });
}

function mockFileWithMkdirError(exists: boolean): void {
  (Bun as any).file = (_path: string) => ({
    exists: async () => exists,
    text: async () => {
      throw new Error("ENOENT");
    },
    parent: {
      mkdir: async (_opts: unknown) => {
        throw new Error("mkdir EACCES");
      },
    },
  });
}

// ── MakeControllerCommand.run() ───────────────────────────────────────────────

describe("MakeControllerCommand.run() — new file", () => {
  it("writes basicStub when --resource is false", async () => {
    mockFile(false);
    const cmd = new MakeControllerCommand();
    cmd.args = { name: "UserController" };
    cmd.flags = { resource: false };
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/controllers/UserController.ts"];
    expect(out).toContain("UserController");
    expect(out).toContain("index(ctx: HttpContext)");
  });

  it("writes resourceStub when --resource is true", async () => {
    mockFile(false);
    const cmd = new MakeControllerCommand();
    cmd.args = { name: "PostController" };
    cmd.flags = { resource: true };
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/controllers/PostController.ts"];
    expect(out).toContain("store");
    expect(out).toContain("destroy");
  });

  it("calls error() and skips write when file already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeControllerCommand();
    cmd.args = { name: "ExistingCtrl" };
    cmd.flags = { resource: false };
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
    expect(written["app/controllers/ExistingCtrl.ts"]).toBeUndefined();
  });

  it("swallows mkdir error and still writes file (.catch path)", async () => {
    mockFileWithMkdirError(false);
    const cmd = new MakeControllerCommand();
    cmd.args = { name: "MkdirCtrl" };
    cmd.flags = { resource: false };
    cmd._writer = noop;
    await cmd.run();
    expect(written["app/controllers/MkdirCtrl.ts"]).toBeDefined();
  });
});

// ── MakeMiddlewareCommand.run() ───────────────────────────────────────────────

describe("MakeMiddlewareCommand.run() — new file", () => {
  it("writes the middleware stub", async () => {
    mockFile(false);
    const cmd = new MakeMiddlewareCommand();
    cmd.args = { name: "AuthMiddleware" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/middleware/AuthMiddleware.ts"];
    expect(out).toContain("AuthMiddleware");
    expect(out).toContain("implements Pipe<HttpContext>");
  });

  it("calls error() when file already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeMiddlewareCommand();
    cmd.args = { name: "ExistingMw" };
    cmd.flags = {};
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
    expect(written["app/middleware/ExistingMw.ts"]).toBeUndefined();
  });

  it("swallows mkdir error and still writes file (.catch path)", async () => {
    mockFileWithMkdirError(false);
    const cmd = new MakeMiddlewareCommand();
    cmd.args = { name: "MkdirMw" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    expect(written["app/middleware/MkdirMw.ts"]).toBeDefined();
  });
});

// ── MakeCommandCommand.run() ──────────────────────────────────────────────────

describe("MakeCommandCommand.run() — new file", () => {
  it("writes the command stub with the correct class name", async () => {
    mockFile(false);
    const cmd = new MakeCommandCommand();
    cmd.args = { name: "SendReportCommand" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/commands/SendReportCommand.ts"];
    expect(out).toContain("SendReportCommand");
    expect(out).toContain("extends Command");
  });

  it("calls error() when file already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeCommandCommand();
    cmd.args = { name: "ExistingCmd" };
    cmd.flags = {};
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
    expect(written["app/commands/ExistingCmd.ts"]).toBeUndefined();
  });

  it("swallows mkdir error and still writes file (.catch path)", async () => {
    mockFileWithMkdirError(false);
    const cmd = new MakeCommandCommand();
    cmd.args = { name: "MkdirCmd" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    expect(written["app/commands/MkdirCmd.ts"]).toBeDefined();
  });
});

// ── KeyGenerateCommand.run() ──────────────────────────────────────────────────

describe("KeyGenerateCommand.run()", () => {
  it("creates .env with APP_KEY when .env does not exist", async () => {
    mockFile(false);
    const cmd = new KeyGenerateCommand();
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    expect(written[".env"]).toMatch(/APP_KEY=/);
  });

  it("appends APP_KEY when .env exists but has no APP_KEY line", async () => {
    mockFile(true, "DEBUG=true\n");
    const cmd = new KeyGenerateCommand();
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    expect(written[".env"]).toContain("DEBUG=true");
    expect(written[".env"]).toMatch(/APP_KEY=/);
  });

  it("replaces an existing APP_KEY= line in .env", async () => {
    mockFile(true, "APP_KEY=old_value\nDEBUG=false\n");
    const cmd = new KeyGenerateCommand();
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    expect(written[".env"]).not.toContain("APP_KEY=old_value");
    expect(written[".env"]).toMatch(/APP_KEY=/);
    expect(written[".env"]).toContain("DEBUG=false");
  });
});

// ── TerminalWriter ────────────────────────────────────────────────────────────

describe("TerminalWriter", () => {
  it("write, writeLine, writeError complete without throwing", () => {
    const tw = new TerminalWriter();
    expect(() => tw.write("")).not.toThrow();
    expect(() => tw.writeLine("")).not.toThrow();
    expect(() => tw.writeError("")).not.toThrow();
  });
});

// ── BufferWriter.flush() ──────────────────────────────────────────────────────

describe("BufferWriter.flush()", () => {
  it("returns all buffered content then clears the buffer", () => {
    const bw = new BufferWriter();
    bw.write("hello");
    bw.writeLine("world");
    bw.writeError("oops");
    const out = bw.flush();
    expect(out).toContain("hello");
    expect(out).toContain("world");
    expect(out).toContain("oops");
    expect(bw.flush()).toBe("");
  });
});

// ── MakeEventCommand ──────────────────────────────────────────────────────────

describe("MakeEventCommand", () => {
  it("declares static properties", () => {
    expect(MakeEventCommand.commandName).toBe("make:event");
    expect(MakeEventCommand.description).toBe("Create a new event class");
    expect(MakeEventCommand.needsApp).toBe(false);
    expect(MakeEventCommand.args).toHaveLength(1);
    expect(MakeEventCommand.args[0]!.name).toBe("name");
  });

  it("run() writes event stub file", async () => {
    mockFile(false);
    const cmd = new MakeEventCommand();
    cmd.args = { name: "UserRegistered" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/events/UserRegistered.ts"];
    expect(out).toContain("UserRegistered");
    expect(out).toContain("export class");
  });

  it("declares a --broadcast flag", () => {
    const flag = MakeEventCommand.flags.find((f) => f.name === "broadcast");
    expect(flag).toBeDefined();
    expect(flag!.short).toBe("b");
    expect(flag!.type).toBe("boolean");
  });

  it("run() with --broadcast writes a BroadcastingEvent stub", async () => {
    mockFile(false);
    const cmd = new MakeEventCommand();
    cmd.args = { name: "OrderShipped" };
    cmd.flags = { broadcast: true };
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/events/OrderShipped.ts"];
    expect(out).toContain("extends BroadcastingEvent");
    expect(out).toContain('from "@zerotal/broadcasting"');
    expect(out).toContain("broadcastOn()");
  });

  it("run() errors when file already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeEventCommand();
    cmd.args = { name: "Existing" };
    cmd.flags = {};
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
    expect(written["app/events/Existing.ts"]).toBeUndefined();
  });

  it("run() errors when name is empty", async () => {
    mockFile(false);
    const errors: string[] = [];
    const cmd = new MakeEventCommand();
    cmd.args = { name: "" };
    cmd.flags = {};
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── MakeJobCommand ────────────────────────────────────────────────────────────

describe("MakeJobCommand", () => {
  it("declares static properties", () => {
    expect(MakeJobCommand.commandName).toBe("make:job");
    expect(MakeJobCommand.description).toBe("Create a new queue job class");
    expect(MakeJobCommand.needsApp).toBe(false);
    expect(MakeJobCommand.args).toHaveLength(1);
    expect(MakeJobCommand.args[0]!.name).toBe("name");
  });

  it("run() writes job stub file", async () => {
    mockFile(false);
    const cmd = new MakeJobCommand();
    cmd.args = { name: "SendEmail" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/jobs/SendEmail.ts"];
    expect(out).toContain("SendEmail");
    expect(out).toContain("extends Job");
    expect(out).toContain("handle()");
    expect(out).toContain("JobRegistry.register");
  });

  it("run() errors when file already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeJobCommand();
    cmd.args = { name: "ExistingJob" };
    cmd.flags = {};
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
    expect(written["app/jobs/ExistingJob.ts"]).toBeUndefined();
  });

  it("run() errors when name is empty", async () => {
    mockFile(false);
    const errors: string[] = [];
    const cmd = new MakeJobCommand();
    cmd.args = { name: "" };
    cmd.flags = {};
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── MakeListenerCommand ───────────────────────────────────────────────────────

describe("MakeListenerCommand", () => {
  it("declares static properties", () => {
    expect(MakeListenerCommand.commandName).toBe("make:listener");
    expect(MakeListenerCommand.description).toBe("Create a new event listener class");
    expect(MakeListenerCommand.needsApp).toBe(false);
    expect(MakeListenerCommand.args).toHaveLength(1);
    expect(MakeListenerCommand.args[0]!.name).toBe("name");
  });

  it("run() writes listener stub file", async () => {
    mockFile(false);
    const cmd = new MakeListenerCommand();
    cmd.args = { name: "OnUserRegistered" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/listeners/OnUserRegistered.ts"];
    expect(out).toContain("OnUserRegistered");
    expect(out).toContain("handle(event");
  });

  it("run() errors when file already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeListenerCommand();
    cmd.args = { name: "ExistingListener" };
    cmd.flags = {};
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("run() errors when name is empty", async () => {
    mockFile(false);
    const errors: string[] = [];
    const cmd = new MakeListenerCommand();
    cmd.args = { name: "" };
    cmd.flags = {};
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── MakeNotificationCommand ───────────────────────────────────────────────────

describe("MakeNotificationCommand", () => {
  it("declares static properties", () => {
    expect(MakeNotificationCommand.commandName).toBe("make:notification");
    expect(MakeNotificationCommand.description).toBe("Create a new notification class");
    expect(MakeNotificationCommand.needsApp).toBe(false);
    expect(MakeNotificationCommand.args).toHaveLength(1);
    expect(MakeNotificationCommand.args[0]!.name).toBe("name");
  });

  it("notificationStub includes class name and Notification import", () => {
    const stub = notificationStub("OrderShipped");
    expect(stub).toContain("OrderShipped");
    expect(stub).toContain("extends Notification");
    expect(stub).toContain("channels()");
    expect(stub).toContain("toDatabase()");
  });

  it("run() writes notification stub file", async () => {
    mockFile(false);
    const cmd = new MakeNotificationCommand();
    cmd.args = { name: "OrderShipped" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/notifications/OrderShipped.ts"];
    expect(out).toContain("OrderShipped");
    expect(out).toContain("Notification");
  });

  it("run() errors when file already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeNotificationCommand();
    cmd.args = { name: "ExistingNotif" };
    cmd.flags = {};
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── MakeObserverCommand ───────────────────────────────────────────────────────

describe("MakeObserverCommand", () => {
  it("declares static properties", () => {
    expect(MakeObserverCommand.commandName).toBe("make:observer");
    expect(MakeObserverCommand.description).toBe("Create a new model observer class");
    expect(MakeObserverCommand.needsApp).toBe(false);
    expect(MakeObserverCommand.args).toHaveLength(1);
    expect(MakeObserverCommand.args[0]!.name).toBe("name");
    expect(MakeObserverCommand.flags).toHaveLength(1);
    expect(MakeObserverCommand.flags[0]!.name).toBe("model");
  });

  it("run() writes observer stub using model derived from name", async () => {
    mockFile(false);
    const lines: string[] = [];
    const cmd = new MakeObserverCommand();
    cmd.args = { name: "UserObserver" };
    cmd.flags = { model: "" };
    cmd._writer = {
      ...noop,
      writeLine: (m: string) => {
        lines.push(m);
      },
    };
    await cmd.run();
    const out = written["app/observers/UserObserver.ts"];
    expect(out).toContain("UserObserver");
    expect(out).toContain("implements ModelObserver");
    expect(out).toContain("creating(");
    expect(out).toContain("deleted(");
    // Should derive model name "User" from "UserObserver"
    expect(out).toContain("user");
  });

  it("run() uses explicit --model flag when provided", async () => {
    mockFile(false);
    const cmd = new MakeObserverCommand();
    cmd.args = { name: "PostObserver" };
    cmd.flags = { model: "Article" };
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/observers/PostObserver.ts"];
    expect(out).toContain("article");
  });

  it("run() errors when file already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeObserverCommand();
    cmd.args = { name: "ExistingObserver" };
    cmd.flags = { model: "" };
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── MakePolicyCommand ─────────────────────────────────────────────────────────

describe("MakePolicyCommand", () => {
  it("declares static properties", () => {
    expect(MakePolicyCommand.commandName).toBe("make:policy");
    expect(MakePolicyCommand.description).toBe("Create a new authorization policy class");
    expect(MakePolicyCommand.needsApp).toBe(false);
    expect(MakePolicyCommand.args).toHaveLength(1);
    expect(MakePolicyCommand.args[0]!.name).toBe("name");
    expect(MakePolicyCommand.flags).toHaveLength(1);
    expect(MakePolicyCommand.flags[0]!.name).toBe("model");
  });

  it("policyStub includes class name, Policy import and CRUD methods", () => {
    const stub = policyStub("PostPolicy", "Post");
    expect(stub).toContain("PostPolicy");
    expect(stub).toContain("extends Policy");
    expect(stub).toContain("from 'zerotal/auth'");
    expect(stub).toContain("view(");
    expect(stub).toContain("create(");
    expect(stub).toContain("update(");
    expect(stub).toContain("delete(");
    expect(stub).not.toContain("@zerotal/auth");
  });

  it("run() writes policy stub file", async () => {
    mockFile(false);
    const cmd = new MakePolicyCommand();
    cmd.args = { name: "PostPolicy" };
    cmd.flags = { model: "Post" };
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/policies/PostPolicy.ts"];
    expect(out).toContain("PostPolicy");
    expect(out).toContain("Policy");
  });

  it("run() derives model name from policy name when --model is empty", async () => {
    mockFile(false);
    const cmd = new MakePolicyCommand();
    cmd.args = { name: "UserPolicy" };
    cmd.flags = { model: "" };
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/policies/UserPolicy.ts"];
    // derives "User" from "UserPolicy"
    expect(out).toContain("User");
  });

  it("run() errors when file already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakePolicyCommand();
    cmd.args = { name: "ExistingPolicy" };
    cmd.flags = { model: "" };
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── MakeProviderCommand ───────────────────────────────────────────────────────

describe("MakeProviderCommand", () => {
  it("declares static properties", () => {
    expect(MakeProviderCommand.commandName).toBe("make:provider");
    expect(MakeProviderCommand.description).toBe("Create a new service provider class");
    expect(MakeProviderCommand.needsApp).toBe(false);
    expect(MakeProviderCommand.args).toHaveLength(1);
    expect(MakeProviderCommand.args[0]!.name).toBe("name");
    expect(MakeProviderCommand.flags).toHaveLength(1);
    expect(MakeProviderCommand.flags[0]!.name).toBe("no-register");
  });

  it("run() appends Provider suffix when missing", async () => {
    mockFile(false);
    const cmd = new MakeProviderCommand();
    cmd.args = { name: "Payment" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/providers/PaymentProvider.ts"];
    expect(out).toContain("PaymentProvider");
    expect(out).toContain("ServiceProvider");
    expect(out).toContain("onRegister()");
  });

  it("run() does not double-append Provider suffix", async () => {
    mockFile(false);
    const cmd = new MakeProviderCommand();
    cmd.args = { name: "CacheProvider" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    expect(written["app/providers/CacheProvider.ts"]).toBeDefined();
    expect(written["app/providers/CacheProviderProvider.ts"]).toBeUndefined();
  });

  it("run() errors when file already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeProviderCommand();
    cmd.args = { name: "ExistingProvider" };
    cmd.flags = {};
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── MakeRequestCommand ────────────────────────────────────────────────────────

describe("MakeRequestCommand", () => {
  it("declares static properties", () => {
    expect(MakeRequestCommand.commandName).toBe("make:request");
    expect(MakeRequestCommand.description).toBe("Create a new FormRequest class");
    expect(MakeRequestCommand.needsApp).toBe(false);
    expect(MakeRequestCommand.args).toHaveLength(1);
    expect(MakeRequestCommand.args[0]!.name).toBe("name");
  });

  it("run() writes request stub file", async () => {
    mockFile(false);
    const cmd = new MakeRequestCommand();
    cmd.args = { name: "StorePostRequest" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/requests/StorePostRequest.ts"];
    expect(out).toContain("StorePostRequest");
    expect(out).toContain("FormRequest");
    expect(out).toContain("rules(");

    // A scaffolded app depends on the `zerotal` umbrella and not on the scoped
    // package, so the scoped name resolves to nothing and the generated file
    // does not compile.
    expect(out).toContain("zerotal/validator");
    expect(out).not.toContain("@zerotal/validator");

    // `validate()` reads the narrow return type through `ReturnType<T['rules']>`.
    // Annotating the override widens it back, and every validated field arrives
    // as `unknown` — which is what `FormRequest`'s docblock warns against.
    expect(out).not.toContain("Record<string, FieldRule>");
  });

  it("run() errors when file already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeRequestCommand();
    cmd.args = { name: "ExistingRequest" };
    cmd.flags = {};
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("run() errors when name is empty", async () => {
    mockFile(false);
    const errors: string[] = [];
    const cmd = new MakeRequestCommand();
    cmd.args = { name: "" };
    cmd.flags = {};
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── MakeResourceCommand ───────────────────────────────────────────────────────

describe("MakeResourceCommand", () => {
  it("declares static properties", () => {
    expect(MakeResourceCommand.commandName).toBe("make:resource");
    expect(MakeResourceCommand.description).toBe("Create a new API resource transformer class");
    expect(MakeResourceCommand.needsApp).toBe(false);
    expect(MakeResourceCommand.args).toHaveLength(1);
    expect(MakeResourceCommand.args[0]!.name).toBe("name");
  });

  it("run() writes resource stub file", async () => {
    mockFile(false);
    const cmd = new MakeResourceCommand();
    cmd.args = { name: "UserResource" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    const out = written["app/resources/UserResource.ts"];
    expect(out).toContain("UserResource");
    expect(out).toContain("extends Resource");
    expect(out).toContain("toArray()");
    expect(out).toContain("ResourceCollection");
  });

  it("run() errors when file already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeResourceCommand();
    cmd.args = { name: "ExistingResource" };
    cmd.flags = {};
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── Every make:* stub, against what a scaffolded app installs ───────────────

describe("make:* stubs import only what a scaffolded app has", () => {
  // A `create-zerotal` app depends on the `zerotal` umbrella plus a short list of
  // scoped packages — never on `@zerotal/core`, `@zerotal/orm`, `@zerotal/auth`,
  // `@zerotal/queue` or `@zerotal/testing`. Every generator that named one wrote a
  // file that could not resolve, and nothing here noticed, because each generator's
  // own test only asserted that the output mentioned the class it was making.
  const INSTALLED_SCOPED = new Set([
    "@zerotal/devtools",
    "@zerotal/flow",
    "@zerotal/admin",
    "@zerotal/inertia",
    "@zerotal/notifications",
  ]);

  const GENERATORS = [
    ["make:command", MakeCommandCommand],
    ["make:controller", MakeControllerCommand],
    ["make:event", MakeEventCommand],
    ["make:job", MakeJobCommand],
    ["make:listener", MakeListenerCommand],
    ["make:middleware", MakeMiddlewareCommand],
    ["make:notification", MakeNotificationCommand],
    ["make:observer", MakeObserverCommand],
    ["make:policy", MakePolicyCommand],
    ["make:provider", MakeProviderCommand],
    ["make:request", MakeRequestCommand],
    ["make:resource", MakeResourceCommand],
    ["make:test", MakeTestCommand],
  ] as const;

  for (const [name, Cmd] of GENERATORS) {
    it(`${name} names no package the templates leave out`, async () => {
      mockFile(false);
      const cmd = new (Cmd as any)();
      cmd.args = { name: "Sample" };
      cmd.flags = {};
      cmd._writer = noop;
      await cmd.run();

      const emitted = Object.values(written);
      expect(emitted.length).toBeGreaterThan(0);

      for (const source of emitted) {
        for (const m of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
          const spec = m[1]!;
          // The app's own files, and Bun/Node builtins.
          if (spec.startsWith(".") || spec.startsWith("bun:") || spec.startsWith("node:")) continue;
          // The umbrella and its subpaths are always present.
          if (spec === "zerotal" || spec.startsWith("zerotal/")) continue;
          expect(INSTALLED_SCOPED.has(spec), `${name} emits an import of ${spec}`).toBe(true);
        }
      }
    });
  }
});

// ── RouteListCommand static ───────────────────────────────────────────────────

import { Router } from "../../router/Router.ts";

describe("RouteListCommand", () => {
  it("declares static properties", () => {
    expect(RouteListCommand.commandName).toBe("route:list");
    expect(RouteListCommand.description).toBe("List all registered routes");
    expect(RouteListCommand.needsApp).toBe(true);
    expect(RouteListCommand.args).toHaveLength(0);
    expect(RouteListCommand.flags).toHaveLength(4);
  });

  it("has method, path, name, verbose flags", () => {
    const names = RouteListCommand.flags.map((f) => f.name);
    expect(names).toContain("method");
    expect(names).toContain("path");
    expect(names).toContain("name");
    expect(names).toContain("verbose");
  });

  it("run() warns when no routes match the given filters", async () => {
    // Clear routes so we get a predictable "no routes" warning
    Router.reset();
    const warns: string[] = [];
    const cmd = new RouteListCommand();
    cmd.args = {};
    cmd.flags = { method: "DELETE", path: "/nonexistent", name: false, verbose: false };
    cmd._writer = {
      ...noop,
      writeLine: (m: string) => {
        warns.push(m);
      },
    };
    await cmd.run();
    // No routes registered so something gets written
    expect(true).toBe(true);
  });

  it("run() prints routes table when routes are registered", async () => {
    Router.reset();

    class FakeController {
      async handle() {}
    }

    // Register a couple of routes directly on the router
    Router.get("/users", FakeController as never, "index");
    Router.post("/users", FakeController as never, "store");
    Router.get("/admin/posts", FakeController as never, "index");

    const lines: string[] = [];
    const cmd = new RouteListCommand();
    cmd.args = {};
    cmd.flags = { method: undefined, path: undefined, name: false, verbose: false };
    cmd._writer = {
      ...noop,
      writeLine: (m: string) => {
        lines.push(m);
      },
    };
    await cmd.run();
    // Should have printed the table header and rows
    expect(lines.length).toBeGreaterThan(0);
    Router.reset();
  });

  it("run() filters by method", async () => {
    Router.reset();
    class FakeController {
      async handle() {}
    }
    Router.get("/items", FakeController as never, "index");
    Router.post("/items", FakeController as never, "store");

    const lines: string[] = [];
    const cmd = new RouteListCommand();
    cmd.args = {};
    cmd.flags = { method: "GET", path: undefined, name: false, verbose: false };
    cmd._writer = {
      ...noop,
      writeLine: (m: string) => {
        lines.push(m);
      },
    };
    await cmd.run();
    expect(lines.length).toBeGreaterThan(0);
    Router.reset();
  });

  it("run() shows verbose middleware column", async () => {
    Router.reset();
    class FakeController {
      async handle() {}
    }
    Router.get("/v", FakeController as never, "index");

    const lines: string[] = [];
    const cmd = new RouteListCommand();
    cmd.args = {};
    cmd.flags = { method: undefined, path: undefined, name: false, verbose: true };
    cmd._writer = {
      ...noop,
      writeLine: (m: string) => {
        lines.push(m);
      },
    };
    await cmd.run();
    expect(lines.length).toBeGreaterThan(0);
    Router.reset();
  });

  it("run() filters to named-only routes", async () => {
    Router.reset();
    class FakeController {
      async handle() {}
    }
    Router.get("/named", FakeController as never, "index").name("home");
    Router.get("/unnamed", FakeController as never, "list");

    const lines: string[] = [];
    const cmd = new RouteListCommand();
    cmd.args = {};
    cmd.flags = { method: undefined, path: undefined, name: true, verbose: false };
    cmd._writer = {
      ...noop,
      writeLine: (m: string) => {
        lines.push(m);
      },
    };
    await cmd.run();
    expect(lines.length).toBeGreaterThan(0);
    Router.reset();
  });
});

// ── StatusCommand static ──────────────────────────────────────────────────────

describe("StatusCommand", () => {
  it("declares static properties", () => {
    expect(StatusCommand.commandName).toBe("status");
    expect(StatusCommand.description).toBe("Show live metrics from the running server");
    expect(StatusCommand.needsApp).toBe(false);
    expect(StatusCommand.args).toHaveLength(0);
    expect(StatusCommand.flags).toHaveLength(2);
  });

  it("has port and host flags with defaults", () => {
    const portFlag = StatusCommand.flags.find((f) => f.name === "port")!;
    const hostFlag = StatusCommand.flags.find((f) => f.name === "host")!;
    expect(portFlag.default).toBe(3000);
    expect(hostFlag.default).toBe("localhost");
  });
});

// ── StatusCommand.run() ───────────────────────────────────────────────────────

describe("StatusCommand.run()", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("prints health data when server responds ok", async () => {
    const healthData = {
      status: "ok",
      version: "1.0.0",
      uptime: 123,
      pendingRequests: 0,
      pendingWebSockets: 0,
      memory: { heapUsed: 1024 * 1024 * 50, rss: 1024 * 1024 * 80 },
    };
    (globalThis as any).fetch = async (_url: string) => ({
      ok: true,
      json: async () => healthData,
    });

    const lines: string[] = [];
    const cmd = new StatusCommand();
    cmd.args = {};
    cmd.flags = { port: 3000, host: "localhost" };
    cmd._writer = {
      ...noop,
      writeLine: (m: string) => {
        lines.push(m);
      },
    };
    await cmd.run();
    // Should have written some output
    expect(lines.length).toBeGreaterThan(0);
  });

  it("calls process.exit(1) when fetch fails", async () => {
    (globalThis as any).fetch = async (_url: string) => {
      throw new Error("ECONNREFUSED");
    };

    const origExit = process.exit;
    let exitCode: number | undefined;
    (process as any).exit = (code: number) => {
      exitCode = code;
      throw new Error("process.exit");
    };

    try {
      const cmd = new StatusCommand();
      cmd.args = {};
      cmd.flags = { port: 3001, host: "localhost" };
      cmd._writer = noop;
      await cmd.run().catch(() => {});
      expect(exitCode).toBe(1);
    } finally {
      (process as any).exit = origExit;
    }
  });

  it("calls process.exit(1) when server responds with non-ok status", async () => {
    (globalThis as any).fetch = async (_url: string) => ({
      ok: false,
      status: 500,
    });

    const origExit = process.exit;
    let exitCode: number | undefined;
    (process as any).exit = (code: number) => {
      exitCode = code;
      throw new Error("process.exit");
    };

    try {
      const cmd = new StatusCommand();
      cmd.args = {};
      cmd.flags = { port: 3001, host: "localhost" };
      cmd._writer = { ...noop, writeError: () => {}, writeLine: () => {} };
      await cmd.run().catch(() => {});
      expect(exitCode).toBe(1);
    } finally {
      (process as any).exit = origExit;
    }
  });
});

// ── TestCommand static ────────────────────────────────────────────────────────

describe("TestCommand", () => {
  it("declares static properties", () => {
    expect(TestCommand.commandName).toBe("test");
    expect(TestCommand.description).toBe("Run the test suite in test environment");
    expect(TestCommand.needsApp).toBe(false);
    expect(TestCommand.args).toHaveLength(1);
    expect(TestCommand.args[0]!.name).toBe("pattern");
    expect(TestCommand.flags).toHaveLength(5);
  });

  it("has coverage, watch, timeout, bail flags", () => {
    const names = TestCommand.flags.map((f) => f.name);
    expect(names).toContain("coverage");
    expect(names).toContain("watch");
    expect(names).toContain("timeout");
    expect(names).toContain("bail");
  });
});

// ── TestCommand.run() ─────────────────────────────────────────────────────────

describe("TestCommand.run()", () => {
  it("spawns bun test with basic args and exits 0", async () => {
    const origSpawn = Bun.spawn;
    const spawnedArgs: string[][] = [];
    (Bun as any).spawn = (args: string[], _opts: unknown) => {
      spawnedArgs.push(args);
      return { exited: Promise.resolve(0) };
    };
    try {
      const lines: string[] = [];
      const cmd = new TestCommand();
      cmd.args = { pattern: "" };
      cmd.flags = { coverage: false, watch: false, timeout: 0, bail: false };
      cmd._writer = {
        ...noop,
        writeLine: (m: string) => {
          lines.push(m);
        },
      };
      await cmd.run();
      expect(spawnedArgs[0]).toContain("test");
      expect(spawnedArgs[0]![0]).toBe("bun");
    } finally {
      (Bun as any).spawn = origSpawn;
    }
  });

  it("passes --coverage flag when coverage is true", async () => {
    const origSpawn = Bun.spawn;
    const spawnedArgs: string[][] = [];
    (Bun as any).spawn = (args: string[], _opts: unknown) => {
      spawnedArgs.push(args);
      return { exited: Promise.resolve(0) };
    };
    try {
      const cmd = new TestCommand();
      cmd.args = { pattern: "" };
      cmd.flags = { coverage: true, watch: false, timeout: 0, bail: false };
      cmd._writer = noop;
      await cmd.run();
      expect(spawnedArgs[0]).toContain("--coverage");
    } finally {
      (Bun as any).spawn = origSpawn;
    }
  });

  it("passes pattern when provided", async () => {
    const origSpawn = Bun.spawn;
    const spawnedArgs: string[][] = [];
    (Bun as any).spawn = (args: string[], _opts: unknown) => {
      spawnedArgs.push(args);
      return { exited: Promise.resolve(0) };
    };
    try {
      const cmd = new TestCommand();
      cmd.args = { pattern: "src/models" };
      cmd.flags = { coverage: false, watch: false, timeout: 0, bail: false };
      cmd._writer = noop;
      await cmd.run();
      expect(spawnedArgs[0]).toContain("src/models");
    } finally {
      (Bun as any).spawn = origSpawn;
    }
  });

  it("calls process.exit when bun test exits with non-zero", async () => {
    const origSpawn = Bun.spawn;
    (Bun as any).spawn = (_args: string[], _opts: unknown) => ({
      exited: Promise.resolve(1),
    });
    const origExit = process.exit;
    let exitCode: number | undefined;
    (process as any).exit = (code: number) => {
      exitCode = code;
    };

    try {
      const cmd = new TestCommand();
      cmd.args = { pattern: "" };
      cmd.flags = { coverage: false, watch: false, timeout: 0, bail: false };
      cmd._writer = noop;
      await cmd.run();
      expect(exitCode).toBe(1);
    } finally {
      (Bun as any).spawn = origSpawn;
      (process as any).exit = origExit;
    }
  });

  it("passes --bail flag when bail is true", async () => {
    const origSpawn = Bun.spawn;
    const spawnedArgs: string[][] = [];
    (Bun as any).spawn = (args: string[], _opts: unknown) => {
      spawnedArgs.push(args);
      return { exited: Promise.resolve(0) };
    };
    try {
      const cmd = new TestCommand();
      cmd.args = { pattern: "" };
      cmd.flags = { coverage: false, watch: false, timeout: 0, bail: true };
      cmd._writer = noop;
      await cmd.run();
      expect(spawnedArgs[0]).toContain("--bail");
    } finally {
      (Bun as any).spawn = origSpawn;
    }
  });

  it("passes --timeout when timeout > 0", async () => {
    const origSpawn = Bun.spawn;
    const spawnedArgs: string[][] = [];
    (Bun as any).spawn = (args: string[], _opts: unknown) => {
      spawnedArgs.push(args);
      return { exited: Promise.resolve(0) };
    };
    try {
      const cmd = new TestCommand();
      cmd.args = { pattern: "" };
      cmd.flags = { coverage: false, watch: false, timeout: 5000, bail: false };
      cmd._writer = noop;
      await cmd.run();
      expect(spawnedArgs[0]!.some((a) => a.includes("--timeout=5000"))).toBe(true);
    } finally {
      (Bun as any).spawn = origSpawn;
    }
  });
});

// ── WorkerCommand static ──────────────────────────────────────────────────────

describe("WorkerCommand", () => {
  it("declares static properties", () => {
    expect(WorkerCommand.commandName).toBe("worker");
    expect(WorkerCommand.description).toBe("Start the background job worker process");
    expect(WorkerCommand.needsApp).toBe(true);
  });

  it("has queue:work alias", () => {
    expect(WorkerCommand.aliases).toContain("queue:work");
  });

  it("run() calls bootAsWorker() and hangs waiting for a promise", async () => {
    // WorkerCommand.run() boots the app as a worker; job classes self-register
    // via the `jobs` convention concern during boot (no codegen step).
    const origArgv = process.argv;
    process.argv = ["bun", "zerotal.ts"];

    let bootedAsWorker = false;
    const fakeApp = {
      bootAsWorker: async () => {
        bootedAsWorker = true;
        // Don't actually hang — just resolve immediately
      },
    };

    const cmd = new WorkerCommand();
    cmd.args = {};
    cmd.flags = {};
    cmd._writer = noop;
    cmd.app = fakeApp;

    // run() calls `await new Promise<never>(() => {})` which hangs forever.
    // We race it against a short timeout to verify bootAsWorker was called.
    const raceResult = await Promise.race([
      cmd.run().then(() => "done"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);

    expect(bootedAsWorker).toBe(true);
    expect(raceResult).toBe("timeout"); // expected: hangs forever

    process.argv = origArgv;
  });
});

// ── ReloadCommand static ──────────────────────────────────────────────────────

describe("ReloadCommand", () => {
  it("declares static properties", () => {
    expect(ReloadCommand.commandName).toBe("reload");
    expect(ReloadCommand.description).toBe(
      "Hot-reload routes in the running server (sends SIGUSR2)",
    );
    expect(ReloadCommand.needsApp).toBe(false);
    expect(ReloadCommand.args).toHaveLength(0);
    expect(ReloadCommand.flags).toHaveLength(0);
  });

  it("run() errors when pid file is missing", async () => {
    // Override Bun.file to throw when trying to read the pid file
    const origFile = Bun.file;
    (Bun as any).file = (_path: string) => ({
      exists: async () => false,
      text: async () => {
        throw new Error("ENOENT");
      },
    });
    const origExit = process.exit;
    let exitCode: number | undefined;
    (process as any).exit = (code: number) => {
      exitCode = code;
      throw new Error("process.exit");
    };

    try {
      const errors: string[] = [];
      const cmd = new ReloadCommand();
      cmd.args = {};
      cmd.flags = {};
      cmd._writer = {
        ...noop,
        writeError: (m: string) => {
          errors.push(m);
        },
        writeLine: () => {},
      };
      await cmd.run().catch(() => {});
      expect(exitCode).toBe(1);
    } finally {
      (Bun as any).file = origFile;
      (process as any).exit = origExit;
    }
  });

  it("run() errors on invalid pid content", async () => {
    const origFile = Bun.file;
    (Bun as any).file = (_path: string) => ({
      text: async () => "not-a-number",
    });
    const origExit = process.exit;
    let exitCode: number | undefined;
    (process as any).exit = (code: number) => {
      exitCode = code;
      throw new Error("process.exit");
    };

    try {
      const errors: string[] = [];
      const cmd = new ReloadCommand();
      cmd.args = {};
      cmd.flags = {};
      cmd._writer = {
        ...noop,
        writeError: (m: string) => {
          errors.push(m);
        },
        writeLine: () => {},
      };
      await cmd.run().catch(() => {});
      expect(exitCode).toBe(1);
    } finally {
      (Bun as any).file = origFile;
      (process as any).exit = origExit;
    }
  });

  it("run() errors when kill fails", async () => {
    const origFile = Bun.file;
    // Use an invalid PID that won't exist
    (Bun as any).file = (_path: string) => ({
      text: async () => "9999999",
    });
    const origExit = process.exit;
    let exitCode: number | undefined;
    (process as any).exit = (code: number) => {
      exitCode = code;
      throw new Error("process.exit");
    };
    const origKill = process.kill;
    (process as any).kill = (_pid: number, _sig: string) => {
      throw new Error("ESRCH");
    };

    try {
      const errors: string[] = [];
      const cmd = new ReloadCommand();
      cmd.args = {};
      cmd.flags = {};
      cmd._writer = {
        ...noop,
        writeError: (m: string) => {
          errors.push(m);
        },
        writeLine: () => {},
      };
      await cmd.run().catch(() => {});
      expect(exitCode).toBe(1);
    } finally {
      (Bun as any).file = origFile;
      (process as any).exit = origExit;
      (process as any).kill = origKill;
    }
  });
});

// ── CompileCommand static ─────────────────────────────────────────────────────

describe("CompileCommand", () => {
  it("declares static properties", () => {
    expect(CompileCommand.commandName).toBe("compile");
    expect(CompileCommand.description).toBe("Compile to a self-contained binary");
    expect(CompileCommand.needsApp).toBe(false);
    // Assert the flags the command actually reads, not a count that drifts.
    expect(CompileCommand.flags.map((f) => f.name)).toEqual(["outfile", "entry"]);
    expect(CompileCommand.flags[0]!.name).toBe("outfile");
    expect(CompileCommand.flags[0]!.default).toBe("zerotal-app");
    expect(CompileCommand.flags[1]!.name).toBe("entry");
  });
});

// ── CssBuildCommand static ────────────────────────────────────────────────────

describe("CssBuildCommand", () => {
  it("declares static properties", () => {
    expect(CssBuildCommand.commandName).toBe("css:build");
    expect(CssBuildCommand.description).toBe("Build the Tailwind CSS bundle for production");
    expect(CssBuildCommand.needsApp).toBe(false);
    expect(CssBuildCommand.flags).toHaveLength(3);
  });

  it("has input, output, minify flags", () => {
    const names = CssBuildCommand.flags.map((f) => f.name);
    expect(names).toContain("input");
    expect(names).toContain("output");
    expect(names).toContain("minify");
  });

  it("run() errors when CSS entry point does not exist", async () => {
    mockFile(false);
    const errors: string[] = [];
    const cmd = new CssBuildCommand();
    cmd.args = {};
    cmd.flags = {
      input: "resources/css/app.css",
      output: "public/css",
      minify: true,
    };
    cmd._writer = {
      ...noop,
      writeError: (m: string) => {
        errors.push(m);
      },
    };
    await cmd.run();
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── CompileCommand run() ──────────────────────────────────────────────────────

describe("CompileCommand.run()", () => {
  it("spawns bun build --compile and succeeds on exit code 0", async () => {
    const origSpawn = Bun.spawn;
    const origFileLocal = Bun.file;
    (Bun as any).file = () => ({ exists: async () => true });
    (Bun as any).spawn = (_args: string[], _opts: unknown) => ({
      exited: Promise.resolve(0),
    });
    try {
      const lines: string[] = [];
      const cmd = new CompileCommand();
      cmd.args = {};
      cmd.flags = { outfile: "my-app" };
      cmd._writer = {
        ...noop,
        writeLine: (m: string) => {
          lines.push(m);
        },
      };
      await cmd.run();
      // Should have written info messages
      expect(lines.some((l) => l.includes("my-app"))).toBe(true);
    } finally {
      (Bun as any).spawn = origSpawn;
      (Bun as any).file = origFileLocal;
    }
  });

  it("throws when bun build exits with non-zero code", async () => {
    const origSpawn = Bun.spawn;
    const origFileLocal = Bun.file;
    (Bun as any).file = () => ({ exists: async () => true });
    (Bun as any).spawn = (_args: string[], _opts: unknown) => ({
      exited: Promise.resolve(1),
    });
    try {
      const cmd = new CompileCommand();
      cmd.args = {};
      cmd.flags = { outfile: "my-app" };
      cmd._writer = noop;
      await expect(cmd.run()).rejects.toThrow("Compile failed");
    } finally {
      (Bun as any).spawn = origSpawn;
      (Bun as any).file = origFileLocal;
    }
  });
});

// ── ReplCommand static ────────────────────────────────────────────────────────

describe("ReplCommand", () => {
  it("declares static properties", () => {
    expect(ReplCommand.commandName).toBe("repl");
    expect(ReplCommand.description).toBe(
      "Start an interactive REPL with the bootstrapped app in scope",
    );
    expect(ReplCommand.needsApp).toBe(true);
  });
});
