import { createFacade } from "@zerotal/core";

/**
 * Static accessor for the scheduler manager. Use for fluent, inline schedule definitions
 * (e.g. inside a provider). For convention-based schedules, extend the `Schedule` base class
 * and place the file in `app/schedules/`.
 *
 * @example
 * Scheduler.job("cleanup", () => purgeTempFiles()).dailyAt("02:00");
 */
export const Scheduler = createFacade("scheduler");
