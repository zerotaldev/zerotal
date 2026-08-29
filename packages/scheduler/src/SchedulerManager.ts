import { ScheduledTask } from "./ScheduledTask.ts";
import type { TaskCallback } from "./ScheduledTask.ts";
import { frameworkLog } from "@zerotal/core/logger";

export class SchedulerManager {
  private _tasks: Map<string, ScheduledTask> = new Map();
  private _started: boolean = false;

  /**
   * Schedule classes found declaring config as `static` during convention
   * discovery (which registers nothing — config is instance properties).
   * Written by the schedules concern, read by the scheduler's doctor check.
   */
  readonly staticConfigFindings: Array<{ className: string; keys: string[] }> = [];

  add(name: string, cronExpression: string, callback: TaskCallback): ScheduledTask {
    const task = new ScheduledTask(name, cronExpression, callback);
    this._tasks.set(name, task);
    if (this._started) task.start();
    return task;
  }

  job(name: string, callback: TaskCallback): SchedulerBuilder {
    return new SchedulerBuilder(this, name, callback);
  }

  /**
   * Register every task with the runtime's cron.
   *
   * A task that cannot be registered takes itself out and nothing else. Registration
   * throws for exactly the reasons that are one task's problem — an expression the
   * runtime rejects, a timezone it does not know — and letting one of them propagate
   * meant the worker died during boot and restart-looped, so a typo in one schedule
   * stopped every schedule in the app. Which ones those are is not a thing you can
   * see from a crash loop.
   */
  start(): void {
    this._started = true;
    for (const task of this._tasks.values()) {
      try {
        task.start();
      } catch (err) {
        frameworkLog("scheduler").error(
          `Task "${task.name}" did not register and will not run: ${(err as Error).message ?? String(err)}`,
          { task: task.name, schedule: task.schedule },
        );
        continue;
      }
      frameworkLog("scheduler").info(`Started "${task.name}" — ${task.schedule}`);
    }
  }

  stop(): void {
    for (const task of this._tasks.values()) task.stop();
    this._started = false;
    frameworkLog("scheduler").info("All tasks stopped");
  }

  get tasks(): ReadonlyMap<string, ScheduledTask> {
    return this._tasks;
  }
}

export class SchedulerBuilder {
  constructor(
    private _manager: SchedulerManager,
    private _name: string,
    private _callback: TaskCallback,
  ) {}

  private static _hm(time: string): [number, number] {
    const [h, m] = time.split(":").map(Number);
    return [h || 0, m || 0];
  }

  cron(expression: string): ScheduledTask {
    return this._manager.add(this._name, expression, this._callback);
  }

  everySecond(): ScheduledTask {
    return this.cron("* * * * * *");
  }
  everyTwoSeconds(): ScheduledTask {
    return this.cron("*/2 * * * * *");
  }
  everyFiveSeconds(): ScheduledTask {
    return this.cron("*/5 * * * * *");
  }
  everyTenSeconds(): ScheduledTask {
    return this.cron("*/10 * * * * *");
  }
  everyThirtySeconds(): ScheduledTask {
    return this.cron("*/30 * * * * *");
  }

  everyMinute(): ScheduledTask {
    return this.cron("* * * * *");
  }
  everyTwoMinutes(): ScheduledTask {
    return this.cron("*/2 * * * *");
  }
  everyThreeMinutes(): ScheduledTask {
    return this.cron("*/3 * * * *");
  }
  everyFourMinutes(): ScheduledTask {
    return this.cron("*/4 * * * *");
  }
  everyFiveMinutes(): ScheduledTask {
    return this.cron("*/5 * * * *");
  }
  everyTenMinutes(): ScheduledTask {
    return this.cron("*/10 * * * *");
  }
  everyFifteenMinutes(): ScheduledTask {
    return this.cron("*/15 * * * *");
  }
  everyThirtyMinutes(): ScheduledTask {
    return this.cron("*/30 * * * *");
  }

  hourly(): ScheduledTask {
    return this.cron("0 * * * *");
  }
  hourlyAt(minute: number): ScheduledTask {
    return this.cron(`${minute} * * * *`);
  }
  everyOddHour(): ScheduledTask {
    return this.cron("0 1-23/2 * * *");
  }
  daily(): ScheduledTask {
    return this.cron("0 0 * * *");
  }
  dailyAt(time: string): ScheduledTask {
    const [h, m] = SchedulerBuilder._hm(time);
    return this.cron(`${m} ${h} * * *`);
  }
  twiceDaily(first = 1, second = 13): ScheduledTask {
    return this.cron(`0 ${first},${second} * * *`);
  }

  weekdays(): ScheduledTask {
    return this.cron("0 0 * * 1-5");
  }
  weekends(): ScheduledTask {
    return this.cron("0 0 * * 6,0");
  }
  sundays(): ScheduledTask {
    return this.cron("0 0 * * 0");
  }
  mondays(): ScheduledTask {
    return this.cron("0 0 * * 1");
  }
  tuesdays(): ScheduledTask {
    return this.cron("0 0 * * 2");
  }
  wednesdays(): ScheduledTask {
    return this.cron("0 0 * * 3");
  }
  thursdays(): ScheduledTask {
    return this.cron("0 0 * * 4");
  }
  fridays(): ScheduledTask {
    return this.cron("0 0 * * 5");
  }
  saturdays(): ScheduledTask {
    return this.cron("0 0 * * 6");
  }
  days(daysOfWeek: number[]): ScheduledTask {
    return this.cron(`0 0 * * ${daysOfWeek.join(",")}`);
  }

  weekly(): ScheduledTask {
    return this.cron("0 0 * * 0");
  }
  twiceWeekly(first = 1, second = 4): ScheduledTask {
    return this.cron(`0 0 * * ${first},${second}`);
  }
  monthly(): ScheduledTask {
    return this.cron("0 0 1 * *");
  }
  twiceMonthly(first = 1, second = 16): ScheduledTask {
    return this.cron(`0 0 ${first},${second} * *`);
  }
  lastDayOfMonth(time = "00:00"): ScheduledTask {
    const [h, m] = SchedulerBuilder._hm(time);
    const task = this.cron(`${m} ${h} 28-31 * *`);
    return task.when(() => {
      const d = new Date();
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return d.getDate() === lastDay;
    });
  }
  quarterly(): ScheduledTask {
    return this.cron("0 0 1 1,4,7,10 *");
  }
  quarterlyOn(dayOfMonth = 1, time = "00:00"): ScheduledTask {
    const [h, m] = SchedulerBuilder._hm(time);
    return this.cron(`${m} ${h} ${dayOfMonth} 1,4,7,10 *`);
  }
  yearly(): ScheduledTask {
    return this.cron("0 0 1 1 *");
  }
  yearlyOn(month = 1, dayOfMonth = 1, time = "00:00"): ScheduledTask {
    const [h, m] = SchedulerBuilder._hm(time);
    return this.cron(`${m} ${h} ${dayOfMonth} ${month} *`);
  }
}
