import { describe, it, expect, afterEach, afterAll } from "bun:test";
import { unlink } from "node:fs/promises";
import { ScheduledTask } from "./ScheduledTask.ts";
import { LockManager, MemoryLockDriver } from "@zerotal/core/lock";

class TestableTask extends ScheduledTask {
  buildHandler(): () => Promise<void> {
    return this._buildHandler();
  }
  acquire(): Promise<boolean> {
    return (this as unknown as { _acquireLock(): Promise<boolean> })._acquireLock();
  }
  release(): Promise<void> {
    return (this as unknown as { _releaseLock(): Promise<void> })._releaseLock();
  }
  lockTtlMs(): number {
    return (this as unknown as { _lockTtlMs: number })._lockTtlMs;
  }
  /**
   * Set a sub-minute TTL, which the public API deliberately will not.
   *
   * `expiresAfterMinutes` clamps to a minimum of one minute — sensible for a
   * scheduler, useless for a test that wants to watch a lock lapse. Going
   * through the field keeps the production floor intact while letting these
   * cases run in seconds instead of minutes.
   */
  setLockTtlMs(ms: number): this {
    (this as unknown as { _lockTtlMs: number })._lockTtlMs = ms;
    return this;
  }
}

afterEach(() => {
  ScheduledTask.outputMailer = undefined;
});

describe("environments()", () => {
  it("skips when current APP_ENV is not allowed", async () => {
    const prev = Bun.env["APP_ENV"];
    Bun.env["APP_ENV"] = "test";
    let calls = 0;
    const task = new TestableTask("e", "* * * * *", async () => {
      calls++;
    }).environments(["production"]);
    await task.buildHandler()();
    expect(calls).toBe(0);
    if (prev === undefined) delete Bun.env["APP_ENV"];
    else Bun.env["APP_ENV"] = prev;
  });
  it("runs when current APP_ENV is allowed", async () => {
    const prev = Bun.env["APP_ENV"];
    Bun.env["APP_ENV"] = "test";
    let calls = 0;
    const task = new TestableTask("e", "* * * * *", async () => {
      calls++;
    }).environments(["test", "staging"]);
    await task.buildHandler()();
    expect(calls).toBe(1);
    if (prev === undefined) delete Bun.env["APP_ENV"];
    else Bun.env["APP_ENV"] = prev;
  });
});

describe("time-window guards", () => {
  it("between() runs inside an all-day window", async () => {
    let calls = 0;
    const task = new TestableTask("w", "* * * * *", async () => {
      calls++;
    }).between("00:00", "23:59");
    await task.buildHandler()();
    expect(calls).toBe(1);
  });
  it("unlessBetween() skips inside an all-day window", async () => {
    let calls = 0;
    const task = new TestableTask("w", "* * * * *", async () => {
      calls++;
    }).unlessBetween("00:00", "23:59");
    await task.buildHandler()();
    expect(calls).toBe(0);
  });
});

describe("conditional guards", () => {
  it("when() blocks the run when predicate is false", async () => {
    let calls = 0;
    const task = new TestableTask("c", "* * * * *", async () => {
      calls++;
    }).when(() => false);
    await task.buildHandler()();
    expect(calls).toBe(0);
  });
  it("skip() blocks the run when predicate is true (async supported)", async () => {
    let calls = 0;
    const task = new TestableTask("c", "* * * * *", async () => {
      calls++;
    }).skip(async () => true);
    await task.buildHandler()();
    expect(calls).toBe(0);
  });
  it("runs when when()=true and skip()=false", async () => {
    let calls = 0;
    const task = new TestableTask("c", "* * * * *", async () => {
      calls++;
    })
      .when(() => true)
      .skip(() => false);
    await task.buildHandler()();
    expect(calls).toBe(1);
  });
});

describe("runInBackground()", () => {
  it("returns from the tick before the callback finishes", async () => {
    let done = false;
    const task = new TestableTask("b", "* * * * *", async () => {
      await new Promise((r) => setTimeout(r, 20));
      done = true;
    }).runInBackground();
    await task.buildHandler()();
    expect(done).toBe(false);
    await new Promise((r) => setTimeout(r, 40));
    expect(done).toBe(true);
  });
});

describe("pings", () => {
  it("calls pingBefore and pingOnSuccess via fetch", async () => {
    const hits: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      hits.push(String(url));
      return new Response("ok");
    }) as typeof fetch;
    const task = new TestableTask("p", "* * * * *", async () => {})
      .pingBefore("https://hc.test/start")
      .pingOnSuccess("https://hc.test/done");
    await task.buildHandler()();
    globalThis.fetch = realFetch;
    expect(hits).toEqual(["https://hc.test/start", "https://hc.test/done"]);
  });
  it("calls pingOnFailure when the callback throws", async () => {
    const hits: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      hits.push(String(url));
      return new Response("ok");
    }) as typeof fetch;
    const task = new TestableTask("p", "* * * * *", async () => {
      throw new Error("x");
    }).pingOnFailure("https://hc.test/fail");
    await task.buildHandler()();
    globalThis.fetch = realFetch;
    expect(hits).toEqual(["https://hc.test/fail"]);
  });
});

describe("output management", () => {
  const SEND = `./.tmp-send-${Date.now()}.log`;
  afterAll(async () => {
    await unlink(SEND).catch(() => {});
  });
  it("sendOutputTo() truncates the file each run", async () => {
    await Bun.write(SEND, "OLD CONTENT\n");
    const task = new TestableTask("o", "* * * * *", async () => {
      console.log("fresh line");
    }).sendOutputTo(SEND);
    await task.buildHandler()();
    const content = await Bun.file(SEND).text();
    expect(content).toContain("fresh line");
    expect(content).not.toContain("OLD CONTENT");
  });
  it("emailOutputTo() routes captured output through the static mailer", async () => {
    const sent: { email: string; body: string }[] = [];
    ScheduledTask.outputMailer = (email, _subject, body) => {
      sent.push({ email, body });
    };
    const task = new TestableTask("o", "* * * * *", async () => {
      console.log("digest row");
    }).emailOutputTo("ops@example.com");
    await task.buildHandler()();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.email).toBe("ops@example.com");
    expect(sent[0]!.body).toContain("digest row");
  });
});

describe("withoutOverlapping() — cross-process lock", () => {
  afterEach(() => {
    ScheduledTask.lockManager = null;
  });

  it("second holder cannot acquire while the first holds the lock", async () => {
    ScheduledTask.lockManager = new LockManager(new MemoryLockDriver());

    const a = new TestableTask("mutexjob", "* * * * *", async () => {}).withoutOverlapping();
    const b = new TestableTask("mutexjob", "* * * * *", async () => {}).withoutOverlapping();

    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    await a.release();
    expect(await b.acquire()).toBe(true);
    await b.release();
  });

  it("falls back to the in-process guard when no lock manager is configured", async () => {
    ScheduledTask.lockManager = null;

    const a = new TestableTask("nomgr", "* * * * *", async () => {}).withoutOverlapping();
    const b = new TestableTask("nomgr", "* * * * *", async () => {}).withoutOverlapping();

    // No distributed lock → _acquireLock degrades to the in-process _running guard.
    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(true);
  });

  it("defaults the lock TTL to minutes rather than a day", () => {
    // The old default was 24h, because the lock could not be extended and the
    // TTL had to cover the longest run anyone might ever schedule. A crashed
    // scheduler then blocked that task until the next afternoon.
    const task = new TestableTask("ttl", "* * * * *", async () => {}).withoutOverlapping();

    expect(task.lockTtlMs()).toBe(5 * 60 * 1000);
    expect(task.lockTtlMs()).toBeLessThan(60 * 60 * 1000);
  });

  it("keeps a short lock alive across a run longer than its TTL", async () => {
    // The payoff: a 1-second TTL and a job that runs for three. A second host
    // must still be locked out at the end, which it would not be without the
    // heartbeat — the lock would have lapsed twice over.
    ScheduledTask.lockManager = new LockManager(new MemoryLockDriver());

    const holder = new TestableTask("longjob", "* * * * *", async () => {})
      .withoutOverlapping()
      .setLockTtlMs(1_000);

    expect(await holder.acquire()).toBe(true);
    await Bun.sleep(3_000);

    const other = new TestableTask("longjob", "* * * * *", async () => {}).withoutOverlapping();
    expect(await other.acquire()).toBe(false);

    await holder.release();
    expect(await other.acquire()).toBe(true);
    await other.release();
  }, 15_000);

  it("lets the lock lapse when refreshing is turned off", async () => {
    // The old behaviour, still available: without a heartbeat the TTL is a hard
    // deadline and a slower job loses its lock.
    ScheduledTask.lockManager = new LockManager(new MemoryLockDriver());

    const holder = new TestableTask("nobeat", "* * * * *", async () => {})
      .withoutOverlapping({ refresh: false })
      .setLockTtlMs(1_000);

    expect(await holder.acquire()).toBe(true);
    await Bun.sleep(1_500);

    const other = new TestableTask("nobeat", "* * * * *", async () => {}).withoutOverlapping();
    expect(await other.acquire()).toBe(true);
    await other.release();
    await holder.release();
  }, 15_000);

  it("stops the heartbeat when the lock is released", async () => {
    // A beat firing after the release would re-acquire the key the task just
    // finished with, and nothing would ever free it.
    const driver = new MemoryLockDriver();
    ScheduledTask.lockManager = new LockManager(driver);

    const task = new TestableTask("beatstop", "* * * * *", async () => {})
      .withoutOverlapping()
      .setLockTtlMs(1_000);

    await task.acquire();
    await task.release();
    await Bun.sleep(800);

    expect(await driver.exists("schedule:beatstop")).toBe(false);
  }, 15_000);
});
