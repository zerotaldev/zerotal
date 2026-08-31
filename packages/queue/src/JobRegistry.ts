import type { Job } from "./Job.ts";

type JobClass = (new (...args: never[]) => Job) & { jobName?: string };

/**
 * Global registry mapping a job's stored name to its constructor.
 * Required for deserialization — when a job is popped from the queue,
 * the worker looks up the class here to instantiate it.
 *
 * The key is {@link Job.jobName} when a job declares one, and the class name
 * otherwise. That distinction exists because the key is written into a persisted
 * payload: a job enqueued yesterday is resolved by today's process, so the name
 * is a compatibility surface and renaming the class is a migration.
 */
export const JobRegistry = {
  _map: new Map<string, JobClass>(),

  register(JobClass: JobClass): void {
    JobRegistry._map.set(JobClass.jobName ?? JobClass.name, JobClass);
  },

  resolve(className: string): JobClass | undefined {
    return JobRegistry._map.get(className);
  },

  all(): ReadonlyMap<string, JobClass> {
    return JobRegistry._map;
  },
};
