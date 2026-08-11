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

/** Every declarative setting `registerSchedule` reads off a Schedule instance. */
const SCHEDULE_CONFIG_KEYS = [
  "name",
  "cron",
  "frequency",
  "timezone",
  "withoutOverlapping",
  "environments",
  "inBackground",
  "between",
  "unlessBetween",
  "pingBefore",
  "pingAfter",
  "pingOnSuccess",
  "pingOnFailure",
  "appendOutputTo",
  "emailOutputTo",
  "when",
  "skip",
] as const;

/**
 * Config keys declared as `static` on a Schedule class. Schedule config is instance
 * properties, but `static cron = "…"` typechecks (it simply declares a new static) and
 * registers nothing — matching the `static` convention used by models (`static fillable`)
 * and Flow components (`static layout`) closely enough to be the natural first attempt.
 * Exported for the doctor.
 */
export function staticScheduleConfigKeys(cls: abstract new () => Schedule): string[] {
  return SCHEDULE_CONFIG_KEYS.filter((key) => {
    const desc = Object.getOwnPropertyDescriptor(cls, key);
    if (desc === undefined) return false;
    // Every class carries an intrinsic non-enumerable `name`; a `static name = "…"`
    // field is enumerable, which is what tells the two apart. Static *methods*
    // (`static frequency() {}`) are non-enumerable by spec, so the other keys are
    // checked by presence alone — no intrinsic shares their names.
    return key === "name" ? desc.enumerable === true : true;
  });
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
      const misdeclared = staticScheduleConfigKeys(exported);
      if (misdeclared.length > 0) {
        frameworkLog("scheduler").warn(
          `Schedule "${exported.name}" declares static ${misdeclared.join(", ")} — ` +
            `schedule config is instance properties, so static values register nothing. ` +
            `Drop the \`static\` keyword (e.g. \`override cron = "0 3 * * *"\`).`,
        );
        manager.staticConfigFindings.push({ className: exported.name, keys: misdeclared });
      }
      registerSchedule(manager, new exported(), exported.name);
    }
  },
};
