/**
 * A job's name is a wire identifier, not a source symbol.
 *
 * The payload persisted in the queue carries a string, and the worker resolves the
 * class by it — so a job enqueued yesterday is looked up by today's process. That
 * makes the class name a compatibility surface, and renaming the class a silent
 * data migration: the code compiles, the tests pass (they enqueue and run in one
 * process), and the failure lands on a deploy with a non-empty queue.
 *
 * `static jobName` decouples the two, exactly as `Migration.id` does for a
 * migration's filename.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { Job } from "./Job.ts";
import { JobRegistry } from "./JobRegistry.ts";

class PlainJob extends Job {
  async handle(): Promise<void> {}
}

class RenamedLater extends Job {
  static override jobName = "TheOriginalName";
  async handle(): Promise<void> {}
}

describe("a job's stored identity", () => {
  beforeEach(() => {
    JobRegistry._map.clear();
  });

  it("defaults to the class name, so nothing changes for a job that says nothing", () => {
    JobRegistry.register(PlainJob);
    expect(JobRegistry.resolve("PlainJob")).toBe(PlainJob);
    expect(new PlainJob().className).toBe("PlainJob");
  });

  it("uses a declared jobName over the class name", () => {
    JobRegistry.register(RenamedLater);
    expect(JobRegistry.resolve("TheOriginalName")).toBe(RenamedLater);
    expect(new RenamedLater().className).toBe("TheOriginalName");
  });

  it("does not answer to the class name once a jobName is declared", () => {
    // The whole point: the class may be renamed freely, and the wire name is the
    // one thing that must not move.
    JobRegistry.register(RenamedLater);
    expect(JobRegistry.resolve("RenamedLater")).toBeUndefined();
  });

  it("keeps what the registry stores and what a job serialises to in agreement", () => {
    // These are two separate code paths reading the same identity. When they
    // disagree, a job is enqueued under one name and resolvable under another —
    // which is a job that never runs and never errors.
    for (const JobClass of [PlainJob, RenamedLater] as const) {
      JobRegistry.register(JobClass);
      const instance = new JobClass();
      expect(JobRegistry.resolve(instance.className)).toBe(JobClass);
    }
  });
});
