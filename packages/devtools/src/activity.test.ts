/**
 * The non-HTTP feed: what the app did when nobody was making a request.
 *
 * A scheduled task that fails at 03:00 used to leave no trace in the tool whose
 * job is to show you what your app did.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { FrameworkEvents, CommandRan } from "@zerotal/core";
import { activityFeed, startActivityCapture, _resetActivity } from "./activity.ts";

let stop: () => void = () => {};

beforeEach(() => {
  _resetActivity();
  stop = startActivityCapture();
});
afterEach(() => {
  stop();
  _resetActivity();
  FrameworkEvents.clear();
});

describe("startActivityCapture", () => {
  it("records a console command", async () => {
    FrameworkEvents.emit(new CommandRan("migrate", 120, 0, true));
    const [entry] = activityFeed();
    expect(entry).toMatchObject({
      kind: "command",
      name: "migrate",
      outcome: "ok",
      durationMs: 120,
      failed: false,
    });
  });

  it("records a failing command with its exit code and error", () => {
    FrameworkEvents.emit(new CommandRan("seed", 5, 1, false, "table missing"));
    const [entry] = activityFeed();
    expect(entry).toMatchObject({ outcome: "exit 1", failed: true, detail: "table missing" });
  });

  it("records a scheduled task by kind string, without importing the scheduler", () => {
    // `@zerotal/scheduler` is optional; naming its event classes here would make
    // devtools depend on it. The bus takes either door.
    class TaskRan {
      constructor(
        readonly name: string,
        readonly durationMs: number,
        readonly ok: boolean,
      ) {}
    }
    FrameworkEvents.emit(new TaskRan("reports:nightly", 900, true));

    const entry = activityFeed().find((e) => e.name === "reports:nightly");
    expect(entry).toMatchObject({ kind: "task", outcome: "ok", durationMs: 900 });
  });

  it("says why a task was skipped", () => {
    // "skipped" alone sends you looking for a bug in a task that was told not to
    // run; the reason is the whole content of the event.
    class TaskSkipped {
      constructor(
        readonly name: string,
        readonly reason: string,
      ) {}
    }
    FrameworkEvents.emit(new TaskSkipped("cleanup", "overlap"));
    expect(activityFeed()[0]!.outcome).toBe("skipped · overlap");
  });

  it("carries a failed task's error", () => {
    class TaskFailed {
      constructor(
        readonly name: string,
        readonly durationMs: number,
        readonly error: string,
      ) {}
    }
    FrameworkEvents.emit(new TaskFailed("sync", 12, "connection refused"));
    expect(activityFeed()[0]).toMatchObject({ failed: true, detail: "connection refused" });
  });

  it("returns newest first", () => {
    FrameworkEvents.emit(new CommandRan("first", 1, 0, true));
    FrameworkEvents.emit(new CommandRan("second", 1, 0, true));
    expect(activityFeed().map((e) => e.name)).toEqual(["second", "first"]);
  });

  it("caps the ring, because a per-minute schedule is 1,440 a day", () => {
    for (let i = 0; i < 260; i++) FrameworkEvents.emit(new CommandRan(`c${i}`, 1, 0, true));
    const feed = activityFeed();
    expect(feed.length).toBe(200);
    // The newest survive; the oldest are the ones dropped.
    expect(feed[0]!.name).toBe("c259");
  });

  it("stops recording once detached", () => {
    stop();
    FrameworkEvents.emit(new CommandRan("after", 1, 0, true));
    expect(activityFeed()).toHaveLength(0);
  });
});
