import type { ConcernDescriptor } from "@zerotal/core";
import { Schedule } from "./Schedule.ts";
import type { SchedulerManager } from "./SchedulerManager.ts";
import type { ScheduledTask } from "./ScheduledTask.ts";
import { frameworkLog } from "@zerotal/core/logger";

function isScheduleClass(v: unknown): v is new () => Schedule {
  return (
    typeof v === "function" &&
    v !== Schedule &&
    (v as { prototype?: unknown }).prototype instanceof Schedule
  );
}

/**
 * Register one Schedule instance with the scheduler manager, translating its declarative
 * settings into a configured ScheduledTask. Exported for testing.
 */
export function registerSchedule(
  manager: SchedulerManager,
  schedule: Schedule,
  fallbackName: string,
): ScheduledTask | undefined {
  const name = schedule.name ?? fallbackName;
  const builder = manager.job(name, () => schedule.handle());

  let task: ScheduledTask;
  if (typeof schedule.frequency === "function") {
    task = schedule.frequency(builder);
  } else if (schedule.cron) {
    task = builder.cron(schedule.cron);
  } else {
    frameworkLog("scheduler").warn(`Schedule "${name}" defines no cron or frequency(); skipped`);
    return undefined;
  }

  if (schedule.timezone) task.timezone(schedule.timezone);
  if (schedule.withoutOverlapping) {
    task.withoutOverlapping(
      typeof schedule.withoutOverlapping === "object" ? schedule.withoutOverlapping : undefined,
    );
  }
  if (schedule.environments) task.environments(schedule.environments);
  if (schedule.inBackground) task.runInBackground();
  if (schedule.between) task.between(schedule.between[0], schedule.between[1]);
  if (schedule.unlessBetween)
    task.unlessBetween(schedule.unlessBetween[0], schedule.unlessBetween[1]);
  if (schedule.pingBefore) task.pingBefore(schedule.pingBefore);
  if (schedule.pingAfter) task.pingAfter(schedule.pingAfter);
  if (schedule.pingOnSuccess) task.pingOnSuccess(schedule.pingOnSuccess);
  if (schedule.pingOnFailure) task.pingOnFailure(schedule.pingOnFailure);
  if (schedule.appendOutputTo) task.appendOutputTo(schedule.appendOutputTo);
  if (schedule.emailOutputTo) task.emailOutputTo(schedule.emailOutputTo);
  if (typeof schedule.when === "function") task.when(() => schedule.when!());
  if (typeof schedule.skip === "function") task.skip(() => schedule.skip!());

  return task;
}

/**
 * `app/schedules/` convention. Every `Schedule` subclass is instantiated and registered with the
 * scheduler. Runs in worker (to execute) and console (so `schedule:list` can enumerate them);
 * never in `web`, so HTTP instances don't run cron. Contributed by `SchedulerProvider`.
 */
export const schedulesConcern: ConcernDescriptor = {
  name: "schedules",
  order: 55,
  dir: "app/schedules",
  envs: ["worker", "console"],
  register(mod, ctx) {
    const manager = ctx.resolve<SchedulerManager>("scheduler");
    if (!manager) {
      frameworkLog("scheduler").warn('app/schedules: "scheduler" binding not available; skipped');
      return;
    }
    for (const exported of Object.values(mod)) {
      if (!isScheduleClass(exported)) continue;
      registerSchedule(manager, new exported(), exported.name);
    }
  },
};
