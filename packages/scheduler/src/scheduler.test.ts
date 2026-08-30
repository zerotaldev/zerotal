import { describe, it, expect, beforeEach } from "bun:test";
import { SchedulerManager } from "./SchedulerManager.ts";
import { ScheduledTask } from "./ScheduledTask.ts";
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
      const task = new ScheduledTask("test", "* * * * *", async () => {});
      task.start();
      task.stop();
      expect(stopCalled).toBe(true);
      expect((task as unknown as Record<string, unknown>)._handle).toBeUndefined();
    } finally {
      (Bun as unknown as Record<string, unknown>).cron = origCron;
    }
  });

  /**
   * This block used to assert that a timezoned task calls `Bun.cron` with croner's
   * options form. `Bun.cron` does not accept that form — it throws — and the test
   * passed because the mock accepted anything the code handed it. The throw
   * happened during registration, so the worker died on boot and restart-looped:
   * one task with a timezone stopped every task in the app, including the ones that
   * release inventory holds and chase deposits.
   *
   * So the first test here runs against the *real* `Bun.cron`. It is the only one
   * that could have caught this, and a mock of a two-argument API is exactly the
   * shape of test that cannot.
   */
  it("registers a timezoned task with the real Bun.cron", () => {
    const task = new ScheduledTask("tz-task", "0 9 * * *", async () => {});
    task.timezone("Africa/Johannesburg");

    expect(() => task.start()).not.toThrow();
    expect((task as unknown as Record<string, unknown>)["_handle"]).toBeDefined();
    task.stop();
  });

  it("start() with a timezone ticks every minute and gates on the zone's clock", () => {
    let registered: string | undefined;
    let handler: (() => Promise<void>) | undefined;
    const origCron = Bun.cron;
    (Bun as unknown as Record<string, unknown>).cron = (expr: string, fn: unknown) => {
      registered = expr;
      handler = fn as () => Promise<void>;
      return { stop: () => {} };
    };

    try {
      const task = new ScheduledTask("tz-task", "0 9 * * *", async () => {});
      task.timezone("Africa/Johannesburg");
      task.start();

      // Bun is asked for every minute; the expression is Zerotal's to evaluate,
      // because Bun.cron only ever reads the system zone.
      expect(registered).toBe("* * * * *");
      expect(typeof handler).toBe("function");
    } finally {
      (Bun as unknown as Record<string, unknown>).cron = origCron;
    }
  });

  it("runs a timezoned task on the zone's clock, not the server's", async () => {
    // 07:00 UTC is 09:00 in Johannesburg (UTC+2, no DST) and 02:00 in New York.
    // A `0 9 * * *` task in Johannesburg must fire on that tick and a New York one
    // must not, whichever zone the machine running this test is in.
    const ran: string[] = [];
    const origCron = Bun.cron;
    let lastHandler: (() => Promise<void>) | undefined;
    (Bun as unknown as Record<string, unknown>).cron = (_expr: string, fn: unknown) => {
      lastHandler = fn as () => Promise<void>;
      return { stop: () => {} };
    };

    const at0700Utc = new Date("2026-03-10T07:00:00Z");
    const realDate = Date;
    try {
      const jhb = new ScheduledTask("jhb", "0 9 * * *", async () => {
        ran.push("jhb");
      });
      jhb.timezone("Africa/Johannesburg");
      jhb.start();
      const jhbHandler = lastHandler!;

      const nyc = new ScheduledTask("nyc", "0 9 * * *", async () => {
        ran.push("nyc");
      });
      nyc.timezone("America/New_York");
      nyc.start();
      const nycHandler = lastHandler!;

      // Freeze the clock on the tick under test. `new Date()` with no arguments
      // answers 07:00 UTC; every other form is passed straight through, because
      // `wallClockIn` builds a Date from Y/M/D parts and has to keep working.
      globalThis.Date = class extends realDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(at0700Utc.getTime());
          else super(...(args as [number]));
        }
      } as DateConstructor;

      await jhbHandler();
      await nycHandler();
    } finally {
      globalThis.Date = realDate;
      (Bun as unknown as Record<string, unknown>).cron = origCron;
    }

    expect(ran).toContain("jhb");
    expect(ran).not.toContain("nyc");
  });

  it("refuses a timezone the runtime does not know, and names the task", () => {
    const task = new ScheduledTask("typo-task", "0 9 * * *", async () => {});
    task.timezone("Africa/Johanesburg"); // one 'n'

    expect(() => task.start()).toThrow(/typo-task/);
    expect(() => task.start()).toThrow(/Africa\/Johanesburg/);
  });
});

// ── SchedulerConfig factory ───────────────────────────────────────────────────

describe("SchedulerConfig", () => {
  it("defaults the timezone to the system zone, not to a literal", () => {
    // `bun test` runs under TZ=UTC, so asserting "UTC" here would pass for the
    // wrong reason and hide the thing that matters: an app that does not set this
    // key keeps whatever its server does. Turning the key from decoration into
    // behaviour would otherwise have moved every schedule in every such app.
    const cfg = SchedulerConfig();
    expect(cfg.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("overrides work", () => {
    const cfg = SchedulerConfig({ timezone: "Africa/Johannesburg" });
    expect(cfg.timezone).toBe("Africa/Johannesburg");
  });
});
