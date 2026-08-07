/**
 * The two always-on sinks: the terminal you watch, and the file trail you read
 * afterwards. They are properties of the logger rather than channels you route
 * to, so neither can be lost by pointing `default` somewhere else.
 */
import { describe, it, expect, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogManager } from "./LogManager.ts";
import { LoggingConfig } from "./config.ts";
import type { LogEntry } from "./types.ts";

// The log trail writes through a LocalDriver, and every local disk must live
// inside the storage root — so the suite moves that root to the OS temp
// directory it is already using for scratch files.
Bun.env["ZT_STORAGE_ROOT"] = tmpdir();

const _dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "zerotal-logs-"));
  _dirs.push(dir);
  return dir;
}

/** Capture stdout for the duration of `fn`. */
function captureStdout(fn: () => void): string {
  const original = process.stdout.write.bind(process.stdout);
  let out = "";
  (process.stdout as unknown as { write: (c: string) => boolean }).write = (chunk: string) => {
    out += chunk;
    return true;
  };
  try {
    fn();
  } finally {
    (process.stdout as unknown as { write: typeof original }).write = original;
  }
  return out;
}

/** The daily file's contents, once the async append has landed. */
async function readDay(dir: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const path = join(dir, `${day}.log`);
  for (let i = 0; i < 50 && !existsSync(path); i++) await Bun.sleep(10);
  if (!existsSync(path)) return "";
  await Bun.sleep(10);
  return readFileSync(path, "utf8");
}

afterEach(async () => {
  // Appends are fire-and-forget, so let any in flight land before the directory
  // goes away — otherwise the writer reports ENOENT into the test output.
  await Bun.sleep(20);
  for (const dir of _dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* the OS will reclaim it */
    }
  }
});

describe("the file trail", () => {
  it("writes every entry by default, with no channel configured", async () => {
    const dir = tempDir();
    const log = new LogManager(LoggingConfig({ console: false, file: { path: dir } }));

    captureStdout(() => log.info("server started", { port: 3000 }));

    const contents = await readDay(dir);
    const entry = JSON.parse(contents.trim()) as LogEntry;
    expect(entry.message).toBe("server started");
    expect(entry.level).toBe("info");
    expect(entry.context).toEqual({ port: 3000 });
  });

  it("groups by date, one file per day", async () => {
    const dir = tempDir();
    const log = new LogManager(LoggingConfig({ console: false, file: { path: dir } }));

    captureStdout(() => log.info("first"));
    await readDay(dir);

    const day = new Date().toISOString().slice(0, 10);
    expect(readdirSync(dir)).toEqual([`${day}.log`]);
  });

  it("records debug, which the console may be filtering out", async () => {
    // The trail is the record; the console threshold controls what you watch.
    const dir = tempDir();
    const log = new LogManager(LoggingConfig({ console: { level: "warn" }, file: { path: dir } }));

    const printed = captureStdout(() => log.debug("cache key computed", { key: "u:1" }));

    expect(printed).toBe("");
    expect(await readDay(dir)).toContain("cache key computed");
  });

  it("keeps writing when the terminal is silenced", async () => {
    const dir = tempDir();
    const log = new LogManager(LoggingConfig({ console: false, file: { path: dir } }));

    const printed = captureStdout(() => log.error("payment declined"));

    expect(printed).toBe("");
    expect(await readDay(dir)).toContain("payment declined");
  });

  it("is off when `file: false`", async () => {
    const dir = tempDir();
    const log = new LogManager(LoggingConfig({ console: false, file: false }));

    captureStdout(() => log.info("nothing on disk"));
    await Bun.sleep(30);

    expect(existsSync(join(dir, `${new Date().toISOString().slice(0, 10)}.log`))).toBe(false);
  });

  it("honours its own level threshold", async () => {
    const dir = tempDir();
    const log = new LogManager(
      LoggingConfig({ console: false, file: { path: dir, level: "warn" } }),
    );

    captureStdout(() => {
      log.info("skipped");
      log.error("kept");
    });

    const contents = await readDay(dir);
    expect(contents).toContain("kept");
    expect(contents).not.toContain("skipped");
  });

  it("prunes files past the retention window", async () => {
    const dir = tempDir();
    // A file from well outside a 14-day window, back-dated so the pruner sees it.
    const stale = join(dir, "2020-01-01.log");
    writeFileSync(stale, "{}\n");
    const longAgo = new Date(Date.now() - 90 * 86_400_000);
    utimesSync(stale, longAgo, longAgo);

    const log = new LogManager(LoggingConfig({ console: false, file: { path: dir, days: 14 } }));
    captureStdout(() => log.info("triggers a prune"));
    await readDay(dir);
    await Bun.sleep(50);

    expect(existsSync(stale)).toBe(false);
  });
});

describe("the console sink", () => {
  it("prints even when the default channel is a file channel", async () => {
    // The old shape made console a channel, so `default: "daily"` silenced the
    // terminal. It is a property of the logger now.
    const dir = tempDir();
    const log = new LogManager(
      LoggingConfig({
        file: false,
        default: "daily",
        channels: { daily: { driver: "daily", path: dir } },
      }),
    );

    const printed = captureStdout(() => log.info("still visible"));

    expect(printed).toContain("still visible");
  });

  it("is off when `console: false`", () => {
    const log = new LogManager(LoggingConfig({ console: false, file: false }));

    expect(captureStdout(() => log.info("silent"))).toBe("");
  });

  it("honours its own level threshold", () => {
    const log = new LogManager(LoggingConfig({ console: { level: "error" }, file: false }));

    const printed = captureStdout(() => {
      log.warn("below threshold");
      log.error("at threshold");
    });

    expect(printed).not.toContain("below threshold");
    expect(printed).toContain("at threshold");
  });
});

describe("no double-writing", () => {
  it("a console channel suppresses the baseline console for its entries", () => {
    const log = new LogManager(
      LoggingConfig({
        file: false,
        default: "term",
        channels: { term: { driver: "console", format: "pretty" } },
      }),
    );

    const printed = captureStdout(() => log.info("once only"));

    expect(printed.match(/once only/g)).toHaveLength(1);
  });

  it("a daily channel suppresses the baseline file for its entries", async () => {
    const baseline = tempDir();
    const routed = tempDir();
    const log = new LogManager(
      LoggingConfig({
        console: false,
        file: { path: baseline },
        default: "archive",
        channels: { archive: { driver: "daily", path: routed } },
      }),
    );

    captureStdout(() => log.info("routed"));
    await readDay(routed);
    await Bun.sleep(30);

    expect(await readDay(routed)).toContain("routed");
    expect(existsSync(join(baseline, `${new Date().toISOString().slice(0, 10)}.log`))).toBe(false);
  });

  it("a stack containing a console channel suppresses the baseline console", () => {
    const log = new LogManager(
      LoggingConfig({
        file: false,
        default: "both",
        channels: {
          both: { driver: "stack", channels: ["term", "void"] },
          term: { driver: "console" },
          void: { driver: "null" },
        },
      }),
    );

    const printed = captureStdout(() => log.info("once via the stack"));

    expect(printed.match(/once via the stack/g)).toHaveLength(1);
  });

  it("a null channel still reaches both baselines — it discards its own writes, not the record", async () => {
    const dir = tempDir();
    const log = new LogManager(
      LoggingConfig({
        file: { path: dir },
        default: "void",
        channels: { void: { driver: "null" } },
      }),
    );

    const printed = captureStdout(() => log.info("still recorded"));

    expect(printed).toContain("still recorded");
    expect(await readDay(dir)).toContain("still recorded");
  });
});

describe("taps see everything", () => {
  it("observes an entry the routed channel filtered out", () => {
    // Monitor taps the logger, so a channel filtered to `error` must not also
    // decide what the panel gets to show.
    const log = new LogManager(
      LoggingConfig({
        console: false,
        file: false,
        default: "quiet",
        channels: { quiet: { driver: "null", level: "error" } as never },
      }),
    );

    const seen: string[] = [];
    const off = LogManager.tap((e) => seen.push(e.message));
    log.info("below the channel threshold");
    off();

    expect(seen).toEqual(["below the channel threshold"]);
  });

  it("observes entries when every sink is disabled", () => {
    const log = new LogManager(LoggingConfig({ console: false, file: false }));

    const seen: string[] = [];
    const off = LogManager.tap((e) => seen.push(e.message));
    log.warn("only the tap is listening");
    off();

    expect(seen).toEqual(["only the tap is listening"]);
  });
});
