import { describe, it, expect } from "bun:test";
import { QueueWorkCommand } from "./QueueWorkCommand.ts";
import { QueueFailedCommand } from "./QueueFailedCommand.ts";
import { QueueFlushCommand } from "./QueueFlushCommand.ts";
import { QueueRetryCommand } from "./QueueRetryCommand.ts";
import { JobRegistry } from "../JobRegistry.ts";
import { Job } from "../Job.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWriter() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    writer: {
      writeLine: (l: string) => lines.push(l),
      writeError: (l: string) => errors.push(l),
      write: (_s: string) => {},
    } as any,
    lines,
    errors,
  };
}

function makeFailedRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    queue: "default",
    className: "TestJob",
    payload: "{}",
    attempts: 1,
    maxAttempts: 3,
    retryDelay: 0,
    failedAt: new Date().toISOString(),
    error: "boom",
    ...overrides,
  };
}

function makeDriver(records: ReturnType<typeof makeFailedRecord>[] = []) {
  const pushed: unknown[] = [];
  const deleted: number[] = [];
  let cleared: string | undefined;
  return {
    pushed,
    deleted,
    get cleared() {
      return cleared;
    },
    async listFailed(queue?: string) {
      return queue ? records.filter((r) => r.queue === queue) : records;
    },
    async push(r: unknown) {
      pushed.push(r);
    },
    async deleteFailedRecord(id: number) {
      deleted.push(id);
    },
    async clearFailed(queue?: string) {
      cleared = queue ?? "all";
    },
  };
}

function makeManager(
  driver: ReturnType<typeof makeDriver>,
  opts: { isShuttingDown?: boolean } = {},
) {
  let shuttingDown = opts.isShuttingDown ?? false;
  const calls: string[] = [];
  return {
    _driver: driver,
    get isShuttingDown() {
      return shuttingDown;
    },
    setShuttingDown(v: boolean) {
      shuttingDown = v;
    },
    async processNext(q: string) {
      calls.push(q);
      return null;
    },
    async size(_q: string) {
      return 0;
    },
    async drain() {},
    processNextCalls: calls,
  };
}

function makeApp(manager: ReturnType<typeof makeManager> | null) {
  return {
    container: {
      tryMake: (key: string) => (key === "queue" ? manager : null),
      makeSync: (key: string) => {
        if (key === "queue") return manager;
        throw new Error(`not bound: ${key}`);
      },
    },
  } as any;
}

function runCmd<
  T extends {
    _writer: any;
    flags: any;
    args: any;
    app: any;
    run(): Promise<void>;
    _readLine?: () => Promise<string>;
  },
>(
  cmd: T,
  opts: {
    flags?: Record<string, unknown>;
    args?: Record<string, string>;
    app?: any;
    readLine?: string;
  } = {},
) {
  const { writer, lines, errors } = makeWriter();
  cmd._writer = writer;
  cmd.flags = opts.flags ?? {};
  cmd.args = opts.args ?? {};
  cmd.app = opts.app;
  if (opts.readLine !== undefined) {
    (cmd as any)._readLine = async () => opts.readLine;
  }
  return { run: () => cmd.run(), lines, errors };
}

// ── QueueWorkCommand ──────────────────────────────────────────────────────────

describe("QueueWorkCommand", () => {
  it("declares static properties", () => {
    expect(QueueWorkCommand.commandName).toBe("queue:work");
    expect(QueueWorkCommand.needsApp).toBe(true);
  });

  it("prints error when app is not available", async () => {
    const cmd = new QueueWorkCommand();
    const { run, errors } = runCmd(cmd, { flags: { queue: "default", once: true } });
    await run();
    expect(errors.some((l) => l.includes("not available"))).toBe(true);
  });

  it("processes one job and reports empty queue when once=true", async () => {
    const driver = makeDriver();
    const manager = makeManager(driver);
    const cmd = new QueueWorkCommand();
    const { run, lines } = runCmd(cmd, {
      flags: { queue: "default", once: true },
      app: makeApp(manager),
    });
    await run();
    expect(lines.some((l) => l.includes("empty"))).toBe(true);
  });

  it("reports processing a job when once=true and queue is non-empty", async () => {
    const driver = makeDriver();
    const manager = makeManager(driver);
    // Override processNext to return a truthy value
    (manager as any).processNext = async () => true;
    const cmd = new QueueWorkCommand();
    const { run, lines } = runCmd(cmd, {
      flags: { queue: "default", once: true },
      app: makeApp(manager),
    });
    await run();
    expect(lines.some((l) => l.includes("1 job"))).toBe(true);
  });

  it("loops until isShuttingDown when once=false", async () => {
    const driver = makeDriver();
    const manager = makeManager(driver, { isShuttingDown: true }); // start already shut down
    const cmd = new QueueWorkCommand();
    const { run, lines } = runCmd(cmd, {
      flags: { queue: "default", once: false },
      app: makeApp(manager),
    });
    await run();
    expect(lines.some((l) => l.includes("stopped"))).toBe(true);
  });
});

// ── QueueFailedCommand ────────────────────────────────────────────────────────

describe("QueueFailedCommand", () => {
  it("declares static properties", () => {
    expect(QueueFailedCommand.commandName).toBe("queue:failed");
    expect(QueueFailedCommand.needsApp).toBe(true);
  });

  it("prints error when queue manager is not registered", async () => {
    const cmd = new QueueFailedCommand();
    const { run, errors } = runCmd(cmd, {
      flags: { queue: "" },
      app: makeApp(null),
    });
    await run();
    expect(errors.some((l) => l.includes("not registered"))).toBe(true);
  });

  it('prints "No failed jobs found" when list is empty', async () => {
    const driver = makeDriver([]);
    const manager = makeManager(driver);
    const cmd = new QueueFailedCommand();
    const { run, lines } = runCmd(cmd, {
      flags: { queue: "" },
      app: makeApp(manager),
    });
    await run();
    expect(lines.some((l) => l.includes("No failed jobs"))).toBe(true);
  });

  it("lists failed jobs when they exist", async () => {
    const records = [
      makeFailedRecord({ id: 1, className: "UserJob", error: "boom" }),
      makeFailedRecord({ id: 2, className: "EmailJob", error: "x".repeat(80) }),
    ];
    const driver = makeDriver(records as any);
    const manager = makeManager(driver);
    const cmd = new QueueFailedCommand();
    const { run, lines } = runCmd(cmd, {
      flags: { queue: "" },
      app: makeApp(manager),
    });
    await run();
    const output = lines.join("\n");
    expect(output).toContain("UserJob");
  });

  it("filters by queue name when provided", async () => {
    const records = [makeFailedRecord({ queue: "emails" })];
    const driver = makeDriver(records as any);
    const manager = makeManager(driver);
    const cmd = new QueueFailedCommand();
    const { run, lines } = runCmd(cmd, {
      flags: { queue: "emails" },
      app: makeApp(manager),
    });
    await run();
    expect(lines.some((l) => l.includes("emails") || l.includes("No failed"))).toBe(true);
  });
});

// ── QueueFlushCommand ─────────────────────────────────────────────────────────

describe("QueueFlushCommand", () => {
  it("declares static properties", () => {
    expect(QueueFlushCommand.commandName).toBe("queue:flush");
    expect(QueueFlushCommand.needsApp).toBe(true);
  });

  it("flushes without confirmation when force=true", async () => {
    const driver = makeDriver();
    const manager = makeManager(driver);
    const cmd = new QueueFlushCommand();
    const { run, lines } = runCmd(cmd, {
      flags: { queue: "", force: true },
      app: makeApp(manager),
    });
    await run();
    expect(lines.some((l) => l.includes("Flushed"))).toBe(true);
    expect(driver.cleared).toBe("all");
  });

  it("flushes a specific queue when provided", async () => {
    const driver = makeDriver();
    const manager = makeManager(driver);
    const cmd = new QueueFlushCommand();
    const { run, lines } = runCmd(cmd, {
      flags: { queue: "emails", force: true },
      app: makeApp(manager),
    });
    await run();
    expect(lines.some((l) => l.includes("emails"))).toBe(true);
  });

  it("aborts when user declines confirmation", async () => {
    const driver = makeDriver();
    const manager = makeManager(driver);
    const cmd = new QueueFlushCommand();
    const { run, lines } = runCmd(cmd, {
      flags: { queue: "", force: false },
      app: makeApp(manager),
      readLine: "n",
    });
    await run();
    expect(lines.some((l) => l.includes("Aborted"))).toBe(true);
    expect(driver.cleared).toBeUndefined();
  });

  it("prints error when no queue manager registered", async () => {
    const cmd = new QueueFlushCommand();
    const { run, errors } = runCmd(cmd, {
      flags: { queue: "", force: true },
      app: makeApp(null),
    });
    await run();
    expect(errors.some((l) => l.includes("not registered"))).toBe(true);
  });
});

// ── QueueRetryCommand ─────────────────────────────────────────────────────────

class FakeRetryJob extends Job {
  async handle() {}
}
JobRegistry.register(FakeRetryJob as never);

describe("QueueRetryCommand", () => {
  it("declares static properties", () => {
    expect(QueueRetryCommand.commandName).toBe("queue:retry");
    expect(QueueRetryCommand.needsApp).toBe(true);
  });

  it("prints error when no queue manager is registered", async () => {
    const cmd = new QueueRetryCommand();
    const { run, errors } = runCmd(cmd, {
      args: { id: "1" },
      app: makeApp(null),
    });
    await run();
    expect(errors.some((l) => l.includes("not registered"))).toBe(true);
  });

  it("prints error for invalid ID", async () => {
    const driver = makeDriver([]);
    const manager = makeManager(driver);
    const cmd = new QueueRetryCommand();
    const { run, errors } = runCmd(cmd, {
      args: { id: "notanumber" },
      app: makeApp(manager),
    });
    await run();
    expect(errors.some((l) => l.includes("Invalid ID"))).toBe(true);
  });

  it("prints error when no failed jobs found with given ID", async () => {
    const driver = makeDriver([]);
    const manager = makeManager(driver);
    const cmd = new QueueRetryCommand();
    const { run, errors } = runCmd(cmd, {
      args: { id: "99" },
      app: makeApp(manager),
    });
    await run();
    expect(errors.some((l) => l.includes("No failed job"))).toBe(true);
  });

  it("retries a known job by ID", async () => {
    const record = makeFailedRecord({ id: 1, className: "FakeRetryJob", payload: "{}" });
    const driver = makeDriver([record as any]);
    const manager = makeManager(driver);
    const cmd = new QueueRetryCommand();
    const { run, lines } = runCmd(cmd, {
      args: { id: "1" },
      app: makeApp(manager),
    });
    await run();
    expect(driver.pushed.length).toBe(1);
    expect(driver.deleted).toContain(1);
    expect(lines.some((l) => l.includes("Retried"))).toBe(true);
  });

  it('retries all failed jobs when id="all"', async () => {
    const records = [
      makeFailedRecord({ id: 1, className: "FakeRetryJob", payload: "{}" }),
      makeFailedRecord({ id: 2, className: "FakeRetryJob", payload: "{}" }),
    ];
    const driver = makeDriver(records as any);
    const manager = makeManager(driver);
    const cmd = new QueueRetryCommand();
    const { run, lines } = runCmd(cmd, {
      args: { id: "all" },
      app: makeApp(manager),
    });
    await run();
    expect(driver.pushed.length).toBe(2);
    expect(lines.some((l) => l.includes("Retried 2"))).toBe(true);
  });

  it("skips unknown job classes with a warning", async () => {
    const record = makeFailedRecord({ id: 1, className: "UnknownJobClass", payload: "{}" });
    const driver = makeDriver([record as any]);
    const manager = makeManager(driver);
    const cmd = new QueueRetryCommand();
    const { run, lines } = runCmd(cmd, {
      args: { id: "all" },
      app: makeApp(manager),
    });
    await run();
    expect(driver.pushed.length).toBe(0);
    expect(lines.some((l) => l.includes("Unknown"))).toBe(true);
    expect(lines.some((l) => l.includes("Retried 0"))).toBe(true);
  });

  it('prints error when no failed jobs found with id="all"', async () => {
    const driver = makeDriver([]);
    const manager = makeManager(driver);
    const cmd = new QueueRetryCommand();
    const { run, errors } = runCmd(cmd, {
      args: { id: "all" },
      app: makeApp(manager),
    });
    await run();
    expect(errors.some((l) => l.includes("No failed jobs"))).toBe(true);
  });
});
