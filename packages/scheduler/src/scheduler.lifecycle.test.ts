import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { unlink } from "node:fs/promises";
import { ScheduledTask } from "./ScheduledTask.ts";
import { SchedulerManager } from "./SchedulerManager.ts";

// ── TestableTask ──────────────────────────────────────────────────────────────
// Subclass that bypasses Bun.cron (unavailable in Bun 1.3.9) so we can invoke
// the handler logic directly in tests via the protected _buildHandler() method.

type StubHandle = { stop(): void; stopped: boolean };
type CapturedTask = { task: TestableTask; handle: StubHandle };

class TestableTask extends ScheduledTask {
  // Expose _buildHandler as public for direct invocation in tests
  buildHandler(): () => Promise<void> {
    return this._buildHandler();
  }

  /** Override start() to skip the real Bun.cron call. */
  override start(): void {
    if ((this as unknown as Record<string, unknown>)._handle) return;
    const handler = this._buildHandler();
    const handle: StubHandle = {
      stop() {
        this.stopped = true;
      },
      stopped: false,
    };
    (this as unknown as Record<string, unknown>)._handle = handle;
    captured.push({ task: this, handle });
    void handler; // handler is available via buildHandler() if tests need it
  }
}

const captured: CapturedTask[] = [];

beforeEach(() => {
  captured.length = 0;
});

// ── ScheduledTask — start / stop ──────────────────────────────────────────────

describe("ScheduledTask — start/stop", () => {
  it("start() sets _handle", () => {
    const task = new TestableTask("t", "0 * * * *", async () => {});
    task.start();
    expect((task as unknown as Record<string, unknown>)._handle).toBeDefined();
    task.stop();
  });

  it("start() is idempotent — calling twice only registers once", () => {
    const task = new TestableTask("t", "* * * * *", async () => {});
    task.start();
    task.start();
    expect(captured).toHaveLength(1);
    task.stop();
  });

  it("stop() clears _handle and calls handle.stop()", () => {
    const task = new TestableTask("t", "* * * * *", async () => {});
    task.start();
    const { handle } = captured[0]!;
    task.stop();
    expect(handle.stopped).toBe(true);
    expect((task as unknown as Record<string, unknown>)._handle).toBeUndefined();
  });

  it("timezone() sets _timezone which is readable on the instance", () => {
    const task = new TestableTask("t", "0 0 * * *", async () => {});
    task.timezone("Africa/Johannesburg");
    expect((task as unknown as Record<string, unknown>)._timezone).toBe("Africa/Johannesburg");
  });
});

// ── ScheduledTask handler — success path ──────────────────────────────────────

describe("ScheduledTask handler — success", () => {
  it("executes the callback on each invocation", async () => {
    let calls = 0;
    const task = new TestableTask("t", "* * * * *", async () => {
      calls++;
    });
    const handler = task.buildHandler();
    await handler();
    await handler();
    expect(calls).toBe(2);
  });

  it("invokes onSuccess after the callback completes", async () => {
    let successCalled = false;
    const task = new TestableTask("t", "* * * * *", async () => {});
    task.onSuccess(() => {
      successCalled = true;
    });
    const handler = task.buildHandler();
    await handler();
    expect(successCalled).toBe(true);
  });

  it("_running is false after a successful run", async () => {
    const task = new TestableTask("t", "* * * * *", async () => {});
    const handler = task.buildHandler();
    await handler();
    expect((task as unknown as Record<string, unknown>)._running).toBe(false);
  });
});

// ── ScheduledTask handler — failure path ─────────────────────────────────────

describe("ScheduledTask handler — failure", () => {
  it("calls onFailure when the callback throws an Error", async () => {
    let caughtErr: Error | undefined;
    const task = new TestableTask("t", "* * * * *", async () => {
      throw new Error("boom");
    });
    task.onFailure((err) => {
      caughtErr = err;
    });
    const handler = task.buildHandler();
    await handler(); // must NOT propagate — error is caught internally
    expect(caughtErr?.message).toBe("boom");
  });

  it("wraps non-Error throws in an Error before passing to onFailure", async () => {
    let caughtErr: Error | undefined;
    const task = new TestableTask("t", "* * * * *", async () => {
      throw "string error";
    });
    task.onFailure((err) => {
      caughtErr = err;
    });
    const handler = task.buildHandler();
    await handler();
    expect(caughtErr).toBeInstanceOf(Error);
    expect(caughtErr!.message).toContain("string error");
  });

  it("_running is false even after a failure", async () => {
    const task = new TestableTask("t", "* * * * *", async () => {
      throw new Error("fail");
    });
    const handler = task.buildHandler();
    await handler();
    expect((task as unknown as Record<string, unknown>)._running).toBe(false);
  });
});

// ── ScheduledTask — withoutOverlapping() ──────────────────────────────────────

describe("ScheduledTask — withoutOverlapping()", () => {
  it("skips the callback when the previous run is still active", async () => {
    let calls = 0;
    const task = new TestableTask("t", "* * * * *", async () => {
      calls++;
    });
    task.withoutOverlapping();
    const handler = task.buildHandler();
    (task as unknown as Record<string, unknown>)._running = true;
    await handler();
    expect(calls).toBe(0);
  });

  it("runs normally when the previous run has finished", async () => {
    let calls = 0;
    const task = new TestableTask("t", "* * * * *", async () => {
      calls++;
    });
    task.withoutOverlapping();
    const handler = task.buildHandler();
    await handler();
    expect(calls).toBe(1);
  });
});

// ── ScheduledTask — appendOutputTo() ─────────────────────────────────────────

// Unique temp path per test run to avoid cross-run collisions
const LOG_PATH = `./.tmp-scheduler-${Date.now()}.log`;

afterAll(async () => {
  await unlink(LOG_PATH).catch(() => {});
  await unlink(LOG_PATH + ".empty").catch(() => {});
});

describe("ScheduledTask — appendOutputTo()", () => {
  it("captures console.log output and writes it to the log file", async () => {
    const task = new TestableTask("t", "* * * * *", async () => {
      console.log("task says hello");
    });
    task.appendOutputTo(LOG_PATH);
    const handler = task.buildHandler();
    await handler();

    const content = await Bun.file(LOG_PATH).text();
    expect(content).toContain("task says hello");
  });

  it("appends to existing file content", async () => {
    await Bun.write(LOG_PATH, "previous\n");

    const task = new TestableTask("t", "* * * * *", async () => {
      console.log("new entry");
    });
    task.appendOutputTo(LOG_PATH);
    const handler = task.buildHandler();
    await handler();

    const content = await Bun.file(LOG_PATH).text();
    expect(content).toContain("previous");
    expect(content).toContain("new entry");
  });

  it("does not write the file when the callback produces no output", async () => {
    const task = new TestableTask("t", "* * * * *", async () => {
      /* silent */
    });
    task.appendOutputTo(LOG_PATH + ".empty");
    const handler = task.buildHandler();
    await handler();

    const exists = await Bun.file(LOG_PATH + ".empty").exists();
    expect(exists).toBe(false);
  });

  it("restores console.log after the handler completes", async () => {
    const original = console.log;
    const task = new TestableTask("t", "* * * * *", async () => {
      console.log("x");
    });
    task.appendOutputTo(LOG_PATH);
    const handler = task.buildHandler();
    await handler();
    expect(console.log).toBe(original);
  });
});

// ── SchedulerManager — lifecycle ──────────────────────────────────────────────
// SchedulerManager creates real ScheduledTask instances, so its lifecycle tests
// need to stub task.start() and task.stop() after the tasks are registered.

describe("SchedulerManager — start()", () => {
  it("sets _started to true", () => {
    const scheduler = new SchedulerManager();
    let started = 0;
    scheduler.add("a", "* * * * *", async () => {});
    // Stub task.start to avoid calling Bun.cron
    for (const t of scheduler.tasks.values()) {
      (t as unknown as Record<string, unknown>).start = () => {
        started++;
      };
    }
    scheduler.start();
    expect((scheduler as unknown as Record<string, unknown>)._started).toBe(true);
    expect(started).toBe(1);
    // Stub stop too so cleanup doesn't call Bun.cron
    for (const t of scheduler.tasks.values()) {
      (t as unknown as Record<string, unknown>).stop = () => {};
    }
    scheduler.stop();
  });

  it("calls task.start() on all pre-registered tasks", () => {
    const scheduler = new SchedulerManager();
    const startedNames: string[] = [];
    scheduler.add("a", "* * * * *", async () => {});
    scheduler.add("b", "0 * * * *", async () => {});
    for (const t of scheduler.tasks.values()) {
      const name = t.name;
      (t as unknown as Record<string, unknown>).start = () => {
        startedNames.push(name);
      };
      (t as unknown as Record<string, unknown>).stop = () => {};
    }
    scheduler.start();
    expect(startedNames).toContain("a");
    expect(startedNames).toContain("b");
    scheduler.stop();
  });
});

describe("SchedulerManager — stop()", () => {
  it("sets _started to false", () => {
    const scheduler = new SchedulerManager();
    scheduler.add("x", "* * * * *", async () => {});
    for (const t of scheduler.tasks.values()) {
      (t as unknown as Record<string, unknown>).start = () => {};
      (t as unknown as Record<string, unknown>).stop = () => {};
    }
    scheduler.start();
    scheduler.stop();
    expect((scheduler as unknown as Record<string, unknown>)._started).toBe(false);
  });

  it("calls task.stop() on all tasks", () => {
    const scheduler = new SchedulerManager();
    const stoppedNames: string[] = [];
    scheduler.add("y", "* * * * *", async () => {});
    for (const t of scheduler.tasks.values()) {
      const name = t.name;
      (t as unknown as Record<string, unknown>).start = () => {};
      (t as unknown as Record<string, unknown>).stop = () => {
        stoppedNames.push(name);
      };
    }
    scheduler.start();
    scheduler.stop();
    expect(stoppedNames).toContain("y");
  });
});

describe("SchedulerManager — add() after start()", () => {
  it("auto-starts a task added while the scheduler is running", () => {
    const scheduler = new SchedulerManager();
    let startCalled = 0;

    // Patch ScheduledTask.prototype.start so Bun.cron is never invoked
    const originalStart = ScheduledTask.prototype.start;
    const originalStop = ScheduledTask.prototype.stop;
    ScheduledTask.prototype.start = function () {
      startCalled++;
    };
    ScheduledTask.prototype.stop = function () {};

    try {
      scheduler.start(); // no tasks yet — start() loop is a no-op
      scheduler.add("late", "0 12 * * *", async () => {});
      expect(startCalled).toBe(1); // add() called task.start() because _started = true
      expect(scheduler.tasks.get("late")!.name).toBe("late");
      scheduler.stop();
    } finally {
      ScheduledTask.prototype.start = originalStart;
      ScheduledTask.prototype.stop = originalStop;
    }
  });
});
