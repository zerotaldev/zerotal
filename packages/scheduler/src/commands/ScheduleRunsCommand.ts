import type { Application } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { ArgDef, FlagDef } from "@zerotal/core";
import type { ScheduleRunStore } from "../runLog.ts";

/**
 * `bun zt schedule:runs [name]` — the durable run history. Answers "did the
 * retention sweep run last night?" from the on-disk record, which survives
 * restarts — unlike the in-memory last-run state `schedule:list` reflects.
 */
export class ScheduleRunsCommand extends Command {
  static override commandName = "schedule:runs";
  static override description = "Show recent scheduled-task runs (durable, survives restarts)";
  static override needsApp = true;

  // The optional positional arg filters to one task's runs.
  static override args: ArgDef[] = [{ name: "name", required: false }];

  static override flags: FlagDef[] = [
    {
      name: "limit",
      short: "n",
      type: "number",
      description: "How many runs to show",
      default: 20,
    },
  ];

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    const store = app?.container.tryMake("scheduler.runs") as ScheduleRunStore | undefined;

    if (!store) {
      this.error("Run store not registered. Add SchedulerProvider to your providers.");
      return;
    }

    const name = this.args["name"];
    const limit = Number(this.flags["limit"] ?? 20);
    const runs = store.recent(limit, name);

    if (runs.length === 0) {
      this.info(
        name
          ? `No recorded runs for "${name}". (The run log records completed executions; ` +
              `it is off under APP_ENV=test.)`
          : "No recorded runs yet.",
      );
      return;
    }

    this.section(name ? `Runs of ${name} (${runs.length})` : `Recent runs (${runs.length})`);
    for (const run of runs) {
      this.table([
        ["Task", run.name],
        ["Started", run.startedAt],
        ["Duration", `${run.durationMs} ms`],
        ["Result", run.ok ? "OK" : `FAILED — ${run.error ?? "unknown error"}`],
      ]);
      this.newLine();
    }
  }
}
