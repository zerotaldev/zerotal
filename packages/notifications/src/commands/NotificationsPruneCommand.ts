import type { Application, FlagDef } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { NotificationManager } from "../NotificationManager.ts";

/**
 * `zt notifications:prune` — delete old stored notifications.
 *
 * The database channel never removes anything on its own, so an app that has
 * been notifying users for a year is carrying a year of rows. Run this on a
 * schedule.
 *
 * @internal
 */
export class NotificationsPruneCommand extends Command {
  static commandName = "notifications:prune";
  static description = "Delete stored notifications older than a given age";
  static needsApp = true;

  static flags: FlagDef[] = [
    {
      name: "days",
      type: "number",
      description: "Age threshold in days",
      default: 30,
    },
    {
      name: "all",
      type: "boolean",
      description: "Also prune notifications that were never read",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    if (!app) {
      this.error("Application not available.");
      return;
    }

    const days = Number(this.flags["days"] ?? 30);
    if (!Number.isFinite(days) || days < 0) {
      this.error(`--days must be a non-negative number, got '${String(this.flags["days"])}'.`);
      return;
    }

    const includeUnread = this.flags["all"] === true;
    const notifications = app.container.makeSync("notifications") as NotificationManager;
    const deleted = await notifications.database.prune(days, includeUnread);

    this.info(
      `Pruned ${deleted} notification(s) older than ${days} day(s)` +
        (includeUnread ? ", including unread." : " that had been read."),
    );
  }
}
