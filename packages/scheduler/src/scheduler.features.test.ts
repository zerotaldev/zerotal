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
});
