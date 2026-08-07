import { describe, it, expect, beforeEach } from "bun:test";
import { LogManager } from "./LogManager.ts";
import { NullChannel } from "./channels/NullChannel.ts";
import { StackChannel } from "./channels/StackChannel.ts";
import { ConsoleChannel } from "./channels/ConsoleChannel.ts";
import { SingleChannel } from "./channels/SingleChannel.ts";
import { DailyChannel } from "./channels/DailyChannel.ts";
import { renderTable } from "./renderTable.ts";
import { displayValue, formatContext } from "./format.ts";
import { tmpdir } from "node:os";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { LogChannel, LogEntry, LogLevel } from "./types.ts";

// File channels write through a LocalDriver, and every local disk must live
// inside the storage root — so this suite moves that root to the OS temp
// directory it already writes its scratch files into.
Bun.env["ZT_STORAGE_ROOT"] = tmpdir();

function spy(): { channel: LogChannel; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const channel: LogChannel = {
    write: async (e) => {
      entries.push(e);
    },
  };
  return { channel, entries };
}

function tick(): Promise<void> {
  return Promise.resolve();
}

function makeManager(
  level: LogLevel,
  override: LogChannel,
  opts: { app?: string; env?: string } = {},
): LogManager {
  return new LogManager(
    { default: "spy", channels: { spy: { driver: "null", level } } },
    { hostname: "test-host", pid: 1, ...opts },
    override,
  );
}

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    level: "info",
    channel: "spy",
    message: "test message",
    timestamp: "2026-06-14T10:00:00.000Z",
    hostname: "host",
    pid: 1,
    ...overrides,
  };
}

describe("LogManager — level filtering", () => {
  it("emits debug when level is debug", async () => {
    const { channel, entries } = spy();
    makeManager("debug", channel).debug("test");
    await tick();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("debug");
  });

  it("suppresses debug when level is info", async () => {
    const { channel, entries } = spy();
    makeManager("info", channel).debug("invisible");
    await tick();
    expect(entries).toHaveLength(0);
  });

  it("suppresses info + debug when level is warn", async () => {
    const { channel, entries } = spy();
    const mgr = makeManager("warn", channel);
    mgr.debug("no");
    mgr.info("no");
    mgr.warn("yes");
    mgr.error("yes");
    await tick();
    expect(entries).toHaveLength(2);
  });

  it("only emits error + fatal when level is error", async () => {
    const { channel, entries } = spy();
    const mgr = makeManager("error", channel);
    mgr.debug("no");
    mgr.info("no");
    mgr.warn("no");
    mgr.error("yes");
    mgr.fatal("yes");
    await tick();
    expect(entries.map((e) => e.level)).toEqual(["error", "fatal"]);
  });

  it("fatal is above error — suppressed when level is fatal", async () => {
    const { channel, entries } = spy();
    const mgr = makeManager("fatal", channel);
    mgr.error("no");
    mgr.fatal("yes");
    await tick();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("fatal");
  });
});

describe("LogManager — entry enrichment", () => {
  let channel: LogChannel;
  let entries: LogEntry[];

  beforeEach(() => {
    ({ channel, entries } = spy());
  });

  it("sets level, channel, message, and ISO timestamp", async () => {
    const before = Date.now();
    makeManager("info", channel).info("hello world");
    await tick();
    expect(entries[0]?.level).toBe("info");
    expect(entries[0]?.message).toBe("hello world");
    expect(entries[0]?.channel).toBe("spy");
    expect(entries[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new Date(entries[0]!.timestamp).getTime()).toBeGreaterThan(before - 1);
  });

  it("always includes hostname and pid", async () => {
    makeManager("info", channel).info("enriched");
    await tick();
    expect(entries[0]?.hostname).toBe("test-host");
    expect(entries[0]?.pid).toBe(1);
  });

  it("includes app and env when provided", async () => {
    makeManager("info", channel, { app: "my-app", env: "production" }).info("message");
    await tick();
    expect(entries[0]?.app).toBe("my-app");
    expect(entries[0]?.env).toBe("production");
  });

  it("omits app and env when not provided", async () => {
    makeManager("info", channel).info("no app");
    await tick();
    expect(entries[0]?.app).toBeUndefined();
    expect(entries[0]?.env).toBeUndefined();
  });

  it("includes context when non-empty and omits when empty", async () => {
    const mgr = makeManager("debug", channel);
    mgr.info("with ctx", { userId: 42 });
    mgr.info("no ctx", {});
    await tick();
    expect(entries[0]?.context).toEqual({ userId: 42 });
    expect(entries[1]?.context).toBeUndefined();
  });

  it("captures Error message and stack", async () => {
    makeManager("debug", channel).error("failed", {}, new Error("boom"));
    await tick();
    expect(entries[0]?.error).toBe("boom");
    expect(entries[0]?.stack).toContain("boom");
  });

  it("captures non-Error values as string", async () => {
    makeManager("debug", channel).error("failed", {}, "string error");
    await tick();
    expect(entries[0]?.error).toBe("string error");
  });

  it("requestId is absent outside a request context", async () => {
    makeManager("info", channel).info("outside request");
    await tick();
    expect(entries[0]?.requestId).toBeUndefined();
  });
});

describe("LogManager — fatal level", () => {
  it("emits at fatal level with context", async () => {
    const { channel, entries } = spy();
    makeManager("fatal", channel).fatal("critical failure", { reason: "oom" });
    await tick();
    expect(entries[0]?.level).toBe("fatal");
    expect(entries[0]?.message).toBe("critical failure");
    expect(entries[0]?.context).toEqual({ reason: "oom" });
  });
});

describe("LogManager — channel()", () => {
  it("routes through a bound logger on the named channel", async () => {
    const { channel, entries } = spy();
    const mgr = makeManager("debug", channel);
    mgr.channel("spy").warn("via channel");
    await tick();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe("via channel");
    expect(entries[0]?.channel).toBe("spy");
  });

  it("respects per-channel min level", async () => {
    const { channel, entries } = spy();
    const mgr = makeManager("error", channel);
    mgr.channel("spy").warn("suppressed");
    mgr.channel("spy").error("emitted");
    await tick();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("error");
  });

  it("does not throw or emit for an unknown channel name", async () => {
    const { channel, entries } = spy();
    const mgr = makeManager("debug", channel);
    expect(() => mgr.channel("nonexistent").info("test")).not.toThrow();
    await tick();
    expect(entries).toHaveLength(0);
  });
});

describe("LogManager — withContext()", () => {
  it("merges extra context into every entry", async () => {
    const { channel, entries } = spy();
    makeManager("debug", channel)
      .withContext({ orderId: 99 })
      .info("order processed", { extra: true });
    await tick();
    expect(entries[0]?.context).toEqual({ orderId: 99, extra: true });
  });

  it("per-call context overrides shared keys", async () => {
    const { channel, entries } = spy();
    makeManager("debug", channel).withContext({ key: "shared" }).info("msg", { key: "per-call" });
    await tick();
    expect(entries[0]?.context?.key).toBe("per-call");
  });

  it("all five levels work through withContext()", async () => {
    const { channel, entries } = spy();
    const bound = makeManager("debug", channel, { app: "test" }).withContext({ req: 1 });
    bound.debug("d");
    bound.info("i");
    bound.warn("w");
    bound.error("e");
    bound.fatal("f");
    await tick();
    expect(entries).toHaveLength(5);
    expect(entries.every((e) => e.context?.req === 1)).toBe(true);
  });
});

describe("LogManager — channel resilience", () => {
  it("does not throw when channel.write() rejects", async () => {
    const bad: LogChannel = {
      write: async () => {
        throw new Error("disk full");
      },
    };
    const mgr = makeManager("info", bad);
    expect(() => mgr.info("oops")).not.toThrow();
    await tick();
  });

  it("throws on construction when a stack references an unknown channel", () => {
    expect(
      () =>
        new LogManager({
          default: "stack",
          channels: { stack: { driver: "stack", channels: ["missing"] } },
        }),
    ).toThrow("missing");
  });
});

describe("NullChannel", () => {
  it("silently discards every entry", async () => {
    await expect(new NullChannel().write()).resolves.toBeUndefined();
  });
});

describe("StackChannel", () => {
  it("fans out to all child channels", async () => {
    const a = spy();
    const b = spy();
    await new StackChannel([a.channel, b.channel]).write(makeEntry({ message: "broadcast" }));
    expect(a.entries).toHaveLength(1);
    expect(b.entries).toHaveLength(1);
    expect(a.entries[0]?.message).toBe("broadcast");
  });

  it("continues writing to other channels when one fails", async () => {
    const bad: LogChannel = {
      write: async () => {
        throw new Error("bad");
      },
    };
    const good = spy();
    await expect(new StackChannel([bad, good.channel]).write(makeEntry())).resolves.toBeUndefined();
    expect(good.entries).toHaveLength(1);
  });
});

// ── ConsoleChannel ────────────────────────────────────────────────────────────

function captureStdout(fn: () => Promise<void>): Promise<string> {
  return new Promise(async (resolve) => {
    let out = "";
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string) => {
      out += s;
      return true;
    };
    try {
      await fn();
    } finally {
      process.stdout.write = original;
    }
    resolve(out);
  });
}

describe("ConsoleChannel — json format", () => {
  it("writes a JSON line containing level, channel, message", async () => {
    const ch = new ConsoleChannel("json");
    const out = await captureStdout(() => ch.write(makeEntry({ level: "warn", message: "oops" })));
    const parsed = JSON.parse(out.trim()) as LogEntry;
    expect(parsed.level).toBe("warn");
    expect(parsed.message).toBe("oops");
    expect(parsed.channel).toBe("spy");
  });
});

describe("ConsoleChannel — pretty format", () => {
  it("contains the message", async () => {
    const out = await captureStdout(() =>
      new ConsoleChannel("pretty").write(makeEntry({ message: "hello world" })),
    );
    expect(out).toContain("hello world");
  });

  it("uses bright-magenta for fatal", async () => {
    const out = await captureStdout(() =>
      new ConsoleChannel("pretty").write(makeEntry({ level: "fatal" })),
    );
    expect(out).toContain("FATAL");
    expect(out).toContain("\x1b[95m");
  });

  it("includes requestId snippet when present", async () => {
    const out = await captureStdout(() =>
      new ConsoleChannel("pretty").write(makeEntry({ requestId: "abcdef12-rest" })),
    );
    expect(out).toContain("abcdef12");
  });

  it("includes context as key=value pairs when non-empty", async () => {
    const out = await captureStdout(() =>
      new ConsoleChannel("pretty").write(makeEntry({ context: { userId: 7 } })),
    );
    expect(out).toContain("userId=");
    expect(out).toContain("7");
  });

  it("includes error message and stack when present", async () => {
    const out = await captureStdout(() =>
      new ConsoleChannel("pretty").write(makeEntry({ error: "conn refused", stack: "at foo" })),
    );
    expect(out).toContain("conn refused");
    expect(out).toContain("at foo");
  });
});

// ── SingleChannel ─────────────────────────────────────────────────────────────

describe("SingleChannel", () => {
  it("appends JSON entries to the log file and creates parent dirs", async () => {
    const dir = join(tmpdir(), `reno-single-${Date.now()}`);
    const file = join(dir, "nested", "app.log");
    const ch = new SingleChannel(file);
    await ch.write(makeEntry({ level: "error", message: "disk error" }));
    const parsed = JSON.parse((await readFile(file, "utf8")).trim()) as LogEntry;
    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("disk error");
    await rm(dir, { recursive: true, force: true });
  });
});

// ── DailyChannel ──────────────────────────────────────────────────────────────

describe("DailyChannel", () => {
  it("writes to YYYY-MM-DD.log and appends multiple entries", async () => {
    const dir = join(tmpdir(), `reno-daily-${Date.now()}`);
    const ch = new DailyChannel(dir);
    const ts = "2026-06-14T12:00:00.000Z";
    await ch.write(makeEntry({ timestamp: ts, message: "first" }));
    await ch.write(makeEntry({ timestamp: ts, message: "second" }));
    const lines = (await readFile(join(dir, "2026-06-14.log"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("second");
    await rm(dir, { recursive: true, force: true });
  });

  it("prunes files older than the days limit", async () => {
    const { writeFile, mkdir, utimes, readdir } = await import("node:fs/promises");
    const dir = join(tmpdir(), `reno-prune-${Date.now()}`);
    await mkdir(dir, { recursive: true });

    const old = join(dir, "2020-01-01.log");
    const keep = join(dir, "2099-12-31.log");
    await writeFile(old, "old\n");
    await writeFile(keep, "new\n");
    const past = new Date("2020-01-01");
    await utimes(old, past, past);

    const ch = new DailyChannel(dir, 1);
    (ch as unknown as Record<string, unknown>)["_lastPruned"] = 0;
    await ch.write(makeEntry({ timestamp: "2099-12-31T00:00:00.000Z" }));
    await new Promise((r) => setTimeout(r, 30));

    const files = await readdir(dir);
    expect(files.includes("2020-01-01.log")).toBe(false);
    expect(files.includes("2099-12-31.log")).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});

// ── Multi-channel construction ────────────────────────────────────────────────

describe("LogManager — channel construction via config", () => {
  it("builds daily/single/console/null/stack from driver key", async () => {
    const dir = join(tmpdir(), `build-${Date.now()}`);
    const file = join(tmpdir(), `build-single-${Date.now()}.log`);
    const mgr = new LogManager({
      default: "stack",
      channels: {
        console: { driver: "console", format: "json" },
        single: { driver: "single", path: file },
        daily: { driver: "daily", path: dir, days: 7 },
        null: { driver: "null" },
        stack: { driver: "stack", channels: ["single"] },
      },
    });
    expect(mgr).toBeDefined();
    await rm(dir, { recursive: true, force: true });
    await rm(file, { force: true });
  });

  it("throws when a stack references an unknown channel name", () => {
    expect(
      () =>
        new LogManager({
          default: "stack",
          channels: { stack: { driver: "stack", channels: ["ghost"] } },
        }),
    ).toThrow("ghost");
  });
});

// ── LoggingConfig factory ─────────────────────────────────────────────────────

describe("LoggingConfig factory", () => {
  it("returns the LoggingConfigShape directly with defaults filled", async () => {
    const { LoggingConfig } = await import("./config.ts");
    const cfg = LoggingConfig({
      default: "daily",
      channels: { daily: { driver: "daily", path: "./logs" } },
    });
    expect(cfg.default).toBe("daily");
    expect(cfg.channels["daily"]?.driver).toBe("daily");
  });

  it("defaults to console plus a dated file trail, with no named channels", async () => {
    const { LoggingConfig } = await import("./config.ts");
    const cfg = LoggingConfig({});

    // Both sinks are on and independent; `channels` is empty because the sinks
    // are the destination, not a channel you route to. The file trail is off
    // under APP_ENV=test so a suite does not grow a storage/logs directory
    // wherever it ran — ask for it explicitly to get it back.
    expect(cfg.console).toEqual({ format: "pretty" });
    expect(cfg.channels).toEqual({});
    expect(LoggingConfig({ file: { path: "./tmp" } }).file).toEqual({ path: "./tmp" });
  });

  it("preserves slowQueryMs when provided", async () => {
    const { LoggingConfig } = await import("./config.ts");
    expect(LoggingConfig({ slowQueryMs: 250 }).slowQueryMs).toBe(250);
  });

  it("LogManager.tap observes every entry until unsubscribed", () => {
    const log = new LogManager({ default: "null", channels: { null: { driver: "null" } } });
    const seen: Array<{ level: string; message: string }> = [];
    const off = LogManager.tap((e) => seen.push({ level: e.level, message: e.message }));

    log.warn("disk almost full", { pct: 92 });
    log.info("warmed");
    off();
    log.error("ignored after unsubscribe");

    expect(seen).toEqual([
      { level: "warn", message: "disk almost full" },
      { level: "info", message: "warmed" },
    ]);
  });
});

describe("scoped logging", () => {
  it("tags every entry from a scoped logger", async () => {
    const { channel, entries } = spy();
    const log = makeManager("debug", channel);

    log.scope("flow").info("Compiled 4 page(s)", { ms: 76 });
    log.info("unscoped");
    await tick();

    expect(entries[0]?.scope).toBe("flow");
    expect(entries[0]?.context).toEqual({ ms: 76 });
    expect(entries[1]?.scope).toBeUndefined();
  });

  it("carries the scope on every level, with the error still attached", async () => {
    const { channel, entries } = spy();
    const log = makeManager("debug", channel).scope("queue");

    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e", undefined, new Error("boom"));
    log.fatal("f");
    await tick();

    expect(entries.map((e) => e.scope)).toEqual(["queue", "queue", "queue", "queue", "queue"]);
    expect(entries[3]?.error).toBe("boom");
  });

  it("renders the scope as an aligned [TAG] on the console", async () => {
    const channel = new ConsoleChannel("pretty");
    const scoped = await captureStdout(() => channel.write(makeEntry({ scope: "flow" })));
    const plain = await captureStdout(() => channel.write(makeEntry()));

    expect(scoped).toContain("[FLOW]");
    // The message starts at the same column whether or not the entry is scoped,
    // which is the whole point of the tag column. Colour escapes take no width,
    // so they come out before measuring.
    const columnOf = (line: string): number =>
      // eslint-disable-next-line no-control-regex
      line.replace(/\x1b\[[0-9;]*m/g, "").indexOf("test message");
    expect(columnOf(scoped)).toBe(columnOf(plain));
  });

  it("keeps the scope as a field in JSON output, for filtering a log file", async () => {
    const out = await captureStdout(() =>
      new ConsoleChannel("json").write(makeEntry({ scope: "queue" })),
    );
    expect((JSON.parse(out.trim()) as LogEntry).scope).toBe("queue");
  });
});

describe("frameworkLog()", () => {
  it("writes through the console without an application, so pre-boot output still appears", async () => {
    const { frameworkLog } = await import("./frameworkLog.ts");
    const out = await captureStdout(async () => {
      frameworkLog("config").error("Config failed to load");
      await tick();
      await tick();
    });

    expect(out).toContain("[CONFIG]");
    expect(out).toContain("Config failed to load");
  });
});

describe("renderTable()", () => {
  const strip = (text: string): string =>
    // eslint-disable-next-line no-control-regex
    text.replace(/\x1b\[[0-9;]*m/g, "");

  it("renders one object as key/value rows, with no header", () => {
    const out = renderTable({ compiled: 4, cached: 2 }).map(strip);

    expect(out[0]).toBe("  ┌──────────┬───┐");
    expect(out[1]).toBe("  │ compiled │ 4 │");
    expect(out[2]).toBe("  │ cached   │ 2 │");
    expect(out[3]).toBe("  └──────────┴───┘");
  });

  it("renders a list as a column per key, with a header", () => {
    const out = renderTable([
      { page: "home", ms: 12 },
      { page: "about", ms: 4 },
    ]).map(strip);

    expect(out[1]).toBe("  │ page  │ ms │");
    expect(out[2]).toBe("  ├───────┼────┤");
    // Numbers right-align so digits line up; text stays left.
    expect(out[3]).toBe("  │ home  │ 12 │");
    expect(out[4]).toBe("  │ about │  4 │");
  });

  it("gives a row a blank cell for a key it lacks, rather than shifting the table", () => {
    const out = renderTable([{ a: 1, b: 2 }, { a: 3 }]).map(strip);

    expect(out[1]).toBe("  │ a │ b │");
    expect(out[4]).toBe("  │ 3 │   │");
  });

  it("keeps strings literal, so a Windows path stays readable", () => {
    const path = String.raw`C:\Projects\docs\public`;
    const out = renderTable({ dir: path }).map(strip);
    expect(out[1]).toContain(path);
    // JSON.stringify would have doubled every separator.
    expect(out[1]).not.toContain(String.raw`\\`);
  });

  it("truncates a cell that would run off the terminal", () => {
    const out = renderTable({ note: "x".repeat(200) }).map(strip);
    expect(out[1]!.length).toBeLessThan(80);
    expect(out[1]).toContain("…");
  });

  it("renders nothing for empty input", () => {
    expect(renderTable({})).toEqual([]);
    expect(renderTable([])).toEqual([]);
  });

  it("does not right-align a column that only sometimes looks numeric", () => {
    const out = renderTable([{ v: "12" }, { v: "n/a" }]).map(strip);
    expect(out[3]).toBe("  │ 12  │");
  });
});

describe("BoundLogger.table()", () => {
  it("attaches an object as ordinary context and marks it for table display", async () => {
    const { channel, entries } = spy();
    makeManager("debug", channel).table("Compile summary", { compiled: 4, cached: 2 });
    await tick();

    expect(entries[0]?.level).toBe("info");
    expect(entries[0]?.display).toBe("table");
    expect(entries[0]?.context).toEqual({ compiled: 4, cached: 2 });
  });

  it("nests a list under `rows`, so context stays an object for collectors", async () => {
    const { channel, entries } = spy();
    makeManager("debug", channel).table("Slow routes", [{ route: "/posts", ms: 812 }], "warn");
    await tick();

    expect(entries[0]?.level).toBe("warn");
    expect(entries[0]?.context).toEqual({ rows: [{ route: "/posts", ms: 812 }] });
  });

  it("carries the scope and any bound context", async () => {
    const { channel, entries } = spy();
    const log = makeManager("debug", channel);
    log.scope("flow").table("Summary", { compiled: 4 });
    log.withContext({ tenant: "acme" }).table("Summary", { compiled: 4 });
    await tick();

    expect(entries[0]?.scope).toBe("flow");
    expect(entries[1]?.context).toEqual({ tenant: "acme", compiled: 4 });
  });

  it("respects the channel's minimum level", async () => {
    const { channel, entries } = spy();
    makeManager("error", channel).table("Summary", { compiled: 4 });
    await tick();

    expect(entries).toHaveLength(0);
  });

  it("prints the table under the message on the console", async () => {
    const out = await captureStdout(() =>
      new ConsoleChannel("pretty").write(makeEntry({ display: "table", context: { compiled: 4 } })),
    );

    // eslint-disable-next-line no-control-regex
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toContain("test message\n");
    expect(plain).toContain("│ compiled │ 4 │");
  });

  it("leaves JSON output as plain structured data", async () => {
    const out = await captureStdout(() =>
      new ConsoleChannel("json").write(makeEntry({ display: "table", context: { compiled: 4 } })),
    );
    const parsed = JSON.parse(out.trim()) as LogEntry;

    expect(parsed.context).toEqual({ compiled: 4 });
    expect(out).not.toContain("┌");
  });
});

describe("formatContext()", () => {
  const plain = (context: Record<string, unknown>): string => formatContext(context, "", "");

  it("renders pairs instead of a JSON blob", () => {
    expect(plain({ port: 3000, env: "web" })).toBe(" port=3000 env=web");
  });

  it("leaves a Windows path literal, where JSON.stringify would double every separator", () => {
    const dir = "C:\\Projects\\app\\public";
    expect(plain({ dir })).toBe(` dir=${dir}`);
    // The behaviour this replaces: JSON doubles every separator.
    expect(JSON.stringify({ dir })).toContain("\\\\");
  });

  it("quotes a value containing whitespace, so pairs stay separable", () => {
    expect(plain({ dir: "C:\\Program Files\\app", port: 1 })).toBe(
      ' dir="C:\\Program Files\\app" port=1',
    );
  });

  it("renders null, empty string, and nested values readably", () => {
    expect(plain({ a: null, b: "", c: { x: 1 }, d: [1, 2] })).toBe(
      ' a=null b="" c={"x":1} d=[1,2]',
    );
  });

  it("dims the keys and leaves the values at full intensity", () => {
    expect(formatContext({ port: 3000 })).toBe(" \x1b[2mport=\x1b[0m3000");
  });

  it("renders nothing for an empty bag", () => {
    expect(plain({})).toBe("");
  });
});

describe("displayValue()", () => {
  it("passes strings through and renders everything else faithfully", () => {
    expect(displayValue("a b")).toBe("a b");
    expect(displayValue(42)).toBe("42");
    expect(displayValue(true)).toBe("true");
    expect(displayValue(null)).toBe("null");
    expect(displayValue(undefined)).toBe("");
    expect(displayValue(new Date("2026-06-14T10:00:00.000Z"))).toBe("2026-06-14T10:00:00.000Z");
    expect(displayValue(new Error("boom"))).toBe("boom");
  });

  it("survives a value that cannot be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(() => displayValue(circular)).not.toThrow();
  });
});
