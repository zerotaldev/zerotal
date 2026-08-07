import type { Job } from "./Job.ts";

type JobClass = new (...args: never[]) => Job;

/**
 * Global registry mapping job class names to their constructors.
 * Required for deserialization — when a job is popped from the queue,
 * the worker looks up the class here to instantiate it.
 */
export const JobRegistry = {
  _map: new Map<string, JobClass>(),

  register(JobClass: JobClass): void {
    JobRegistry._map.set(JobClass.name, JobClass);
  },

  resolve(className: string): JobClass | undefined {
    return JobRegistry._map.get(className);
  },

  all(): ReadonlyMap<string, JobClass> {
    return JobRegistry._map;
  },
};
