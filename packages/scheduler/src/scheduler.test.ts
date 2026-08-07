import { describe, it, expect, beforeEach } from "bun:test";
import { SchedulerManager } from "./SchedulerManager.ts";
import { SchedulerConfig } from "./config.ts";

describe("SchedulerManager", () => {
  let scheduler: SchedulerManager;

  beforeEach(() => {
    scheduler = new SchedulerManager();
  });

  it("add() registers a task", () => {
    scheduler.add("test", "* * * * *", async () => {});
    expect(scheduler.tasks.size).toBe(1);
    expect(scheduler.tasks.get("test")?.name).toBe("test");
    expect(scheduler.tasks.get("test")?.schedule).toBe("* * * * *");
  });

  it("job().cron() registers with correct schedule", () => {
    scheduler.job("cleanup", async () => {}).cron("0 0 * * *");
    expect(scheduler.tasks.get("cleanup")?.schedule).toBe("0 0 * * *");
  });

  it("job().daily() is a shorthand for midnight cron", () => {
    scheduler.job("report", async () => {}).daily();
    expect(scheduler.tasks.get("report")?.schedule).toBe("0 0 * * *");
  });

  it("job().hourly() is a shorthand", () => {
    scheduler.job("sync", async () => {}).hourly();
    expect(scheduler.tasks.get("sync")?.schedule).toBe("0 * * * *");
  });

  it("job().everyMinute() is a shorthand", () => {
    scheduler.job("ping", async () => {}).everyMinute();
    expect(scheduler.tasks.get("ping")?.schedule).toBe("* * * * *");
  });

  it("job().weekly() is a shorthand for midnight Sunday", () => {
    scheduler.job("archive", async () => {}).weekly();
    expect(scheduler.tasks.get("archive")?.schedule).toBe("0 0 * * 0");
  });

  it("job().monthly() is a shorthand for midnight on the 1st", () => {
    scheduler.job("invoice", async () => {}).monthly();
    expect(scheduler.tasks.get("invoice")?.schedule).toBe("0 0 1 * *");
  });

  it("multiple tasks can be registered", () => {
    scheduler.add("a", "* * * * *", async () => {});
    scheduler.add("b", "0 * * * *", async () => {});
    expect(scheduler.tasks.size).toBe(2);
  });
});

describe("ScheduledTask", () => {
  it("withoutOverlapping() returns the task for chaining", () => {
    const scheduler = new SchedulerManager();
    const task = scheduler.job("test", async () => {}).everyMinute();
    const chained = task.withoutOverlapping();
    expect(chained).toBe(task);
  });
});

describe("ScheduledTask callbacks", () => {
  it("onSuccess() stores the callback and returns this for chaining", () => {
    const scheduler = new SchedulerManager();
    let successCalled = false;
    const task = scheduler
      .job("test-success", async () => {})
      .everyMinute()
      .onSuccess(() => {
        successCalled = true;
      });

    expect(task).toBeDefined();
    // Verify the stored callback fires correctly
    const stored = (task as unknown as Record<string, unknown>)._onSuccess as
      (() => void) | undefined;
    expect(typeof stored).toBe("function");
    stored?.();
    expect(successCalled).toBe(true);
  });

  it("onFailure() stores the callback and returns this for chaining", () => {
    const scheduler = new SchedulerManager();
    let caughtError: Error | undefined;
    const task = scheduler
      .job("test-failure", async () => {
        throw new Error("oops");
      })
      .everyMinute()
      .onFailure((err) => {
        caughtError = err;
      });

    expect(task).toBeDefined();
    const stored = (task as unknown as Record<string, unknown>)._onFailure as
      ((err: Error) => void) | undefined;
    expect(typeof stored).toBe("function");
    stored?.(new Error("oops"));
    expect(caughtError?.message).toBe("oops");
  });

  it("appendOutputTo() sets the output path and returns this for chaining", () => {
    const scheduler = new SchedulerManager();
    const task = scheduler
      .job("test-output", async () => {})
      .everyMinute()
      .appendOutputTo("./storage/logs/test.log");

    expect((task as unknown as Record<string, unknown>)._outputPath).toBe(
      "./storage/logs/test.log",
    );
  });

  it("withoutOverlapping() sets _skipIfStillRunning to true", () => {
    const scheduler = new SchedulerManager();
    const task = scheduler
      .job("overlap", async () => {})
      .everyMinute()
      .withoutOverlapping();
    expect((task as unknown as Record<string, unknown>)._skipIfStillRunning).toBe(true);
  });

  it("chaining onSuccess + onFailure + appendOutputTo works", () => {
    const scheduler = new SchedulerManager();
    const task = scheduler
      .job("chained", async () => {})
      .daily()
      .onSuccess(() => {})
      .onFailure(() => {})
      .appendOutputTo("./logs/chained.log");

    const t = task as unknown as Record<string, unknown>;
    expect(typeof t._onSuccess).toBe("function");
    expect(typeof t._onFailure).toBe("function");
    expect(t._outputPath).toBe("./logs/chained.log");
  });
});

// ── ScheduledTask.start() / stop() ───────────────────────────────────────────

describe("ScheduledTask.start() / stop()", () => {
  it("start() calls Bun.cron and stores a handle", () => {
    // Mock Bun.cron so we don't actually schedule anything
    const handles: { stop: () => void }[] = [];
    const origCron = Bun.cron;
    (Bun as unknown as Record<string, unknown>).cron = (_expr: string, _handler: unknown) => {
      const handle = { stop: () => {} };
      handles.push(handle);
      return handle;
    };

    try {
      const { ScheduledTask } = require("./ScheduledTask.ts");
      const task = new ScheduledTask("test", "* * * * *", async () => {});
      task.start();
      expect(handles).toHaveLength(1);
      expect((task as unknown as Record<string, unknown>)._handle).toBeDefined();
    } finally {
      (Bun as unknown as Record<string, unknown>).cron = origCron;
    }
  });

  it("start() is idempotent — calling twice only creates one handle", () => {
    const handles: { stop: () => void }[] = [];
    const origCron = Bun.cron;
    (Bun as unknown as Record<string, unknown>).cron = (_expr: string, _handler: unknown) => {
      const handle = { stop: () => {} };
      handles.push(handle);
      return handle;
    };

    try {
      const { ScheduledTask } = require("./ScheduledTask.ts");
      const task = new ScheduledTask("test", "* * * * *", async () => {});
      task.start();
      task.start(); // second call is a no-op
      expect(handles).toHaveLength(1);
    } finally {
      (Bun as unknown as Record<string, unknown>).cron = origCron;
    }
  });

  it("stop() calls handle.stop() and clears the handle", () => {
    let stopCalled = false;
    const origCron = Bun.cron;
    (Bun as unknown as Record<string, unknown>).cron = (_expr: string, _handler: unknown) => ({
      stop: () => {
        stopCalled = true;
      },
    });

    try {
      const { ScheduledTask } = require("./ScheduledTask.ts");
      const task = new ScheduledTask("test", "* * * * *", async () => {});
      task.start();
      task.stop();
      expect(stopCalled).toBe(true);
      expect((task as unknown as Record<string, unknown>)._handle).toBeUndefined();
    } finally {
      (Bun as unknown as Record<string, unknown>).cron = origCron;
    }
  });

  it("start() with timezone uses options form of Bun.cron", () => {
    let receivedOptions: unknown;
    const origCron = Bun.cron;
    (Bun as unknown as Record<string, unknown>).cron = (_expr: string, optsOrHandler: unknown) => {
      receivedOptions = optsOrHandler;
      return { stop: () => {} };
    };

    try {
      const { ScheduledTask } = require("./ScheduledTask.ts");
      const task = new ScheduledTask("tz-task", "0 9 * * *", async () => {});
      task.timezone("Africa/Johannesburg");
      task.start();
      // When a timezone is set, Bun.cron is called with an options object
      expect(typeof receivedOptions).toBe("object");
      expect((receivedOptions as Record<string, unknown>)["timezone"]).toBe("Africa/Johannesburg");
    } finally {
      (Bun as unknown as Record<string, unknown>).cron = origCron;
    }
  });
});

// ── SchedulerConfig factory ───────────────────────────────────────────────────

describe("SchedulerConfig", () => {
  it("returns defaults when called with no arguments", () => {
    const cfg = SchedulerConfig();
    expect(cfg.timezone).toBe("UTC");
  });

  it("overrides work", () => {
    const cfg = SchedulerConfig({ timezone: "Africa/Johannesburg" });
    expect(cfg.timezone).toBe("Africa/Johannesburg");
  });
});
