export { SchedulerManager, SchedulerBuilder } from "./SchedulerManager.ts";
export { ScheduledTask } from "./ScheduledTask.ts";
export { CronExpression } from "./CronExpression.ts";
export { SchedulerProvider } from "./provider/SchedulerProvider.ts";

// Convention-based scheduling: extend Schedule, drop it in app/schedules/.
export { Schedule } from "./Schedule.ts";
export { schedulesConcern, registerSchedule } from "./conventions.ts";

// Fluent inline scheduling facade (renamed from the former `Schedule` facade).
export { Scheduler } from "./facades/Scheduler.ts";

export type {
  TaskCallback,
  TaskGuard,
  TaskHook,
  OutputMailer,
  OverlapLockOptions,
} from "./ScheduledTask.ts";

// Config factory
export { SchedulerConfig } from "./config.ts";
export type { SchedulerConfigShape } from "./config.ts";

// Framework instrumentation events (emitted on the core FrameworkEvents bus)
export { TaskRan, TaskFailed, TaskSkipped } from "./events.ts";
