import type { Command } from "@zerotal/core";

/**
 * Import `app/schedules.ts`, where an app may keep inline `Scheduler.job(...)` definitions.
 *
 * Classes in `app/schedules/` need nothing from here: the convention registers them
 * when a console command boots the app. A file that fails to load is reported as a
 * warning, so the schedules that did load can still be listed or run.
 *
 * @internal
 */
export async function _loadSchedulesFile(command: Command): Promise<void> {
  const schedulesFile = `${process.cwd()}/app/schedules.ts`;
  if (!(await Bun.file(schedulesFile).exists())) return;
  try {
    await import(schedulesFile);
  } catch (err) {
    command.warn(`Failed to load app/schedules.ts: ${(err as Error).message}`);
  }
}
