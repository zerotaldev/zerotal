/**
 * The `zt doctor` check for the packages a panel's features need but the admin
 * package does not install.
 *
 * Database notifications need `@zerotal/notifications`, and a resource with
 * `static history = true` needs `@zerotal/audit`. Without the package, each
 * throws `OptionalPeerMissingError` the first time it runs: on the notifications
 * page, or on a record's view page. That is the right failure, but it waits for
 * someone to open the page. This reads the panels instead, so the doctor reports
 * the missing package before a request does.
 *
 * Queued imports need `@zerotal/queue` too, but the option lives inside a
 * resource's action list, which only exists once a page builds it. That one is
 * reported when an import is queued.
 *
 * @module
 */
import type { DoctorCheck, DoctorCheckResult } from "@zerotal/core";
import { OptionalPeerMissingError } from "@zerotal/core/runtime";
import { Panel } from "./Panel.ts";
import { isDatabaseNotifications, loadNotifications } from "./databaseNotifications.ts";
import { loadAudit } from "./history.ts";

/** What the check needs from its caller. */
export interface AdminPackagesCheckOptions {
  /**
   * Load the app's panel wiring before reading it. `zt doctor` boots the app as
   * a console app, where the provider does not load `app/admin.ts`.
   */
  prepare?: (() => Promise<void>) | undefined;
  /** How to load each package. Replaceable so a test can stand one in as missing. */
  loaders?: { audit: () => Promise<unknown>; notifications: () => Promise<unknown> } | undefined;
}

/**
 * Build the check: it fails when a panel uses database notifications or record
 * history without the package that feature loads.
 *
 * @param options - How to prepare the panels and load the packages.
 */
export function adminPackagesCheck(options: AdminPackagesCheckOptions = {}): DoctorCheck {
  const loaders = options.loaders ?? { audit: loadAudit, notifications: loadNotifications };
  return {
    id: "admin-optional-packages",
    label: "Admin optional packages",
    async run(): Promise<DoctorCheckResult> {
      await options.prepare?.();

      const wanted = new Set<"audit" | "notifications">();
      for (const panel of Panel.all()) {
        if (panel.resources().some((resource) => resource.history)) wanted.add("audit");
        const provider = panel.notificationProvider();
        if (provider && isDatabaseNotifications(provider)) wanted.add("notifications");
      }
      if (wanted.size === 0) {
        return { status: "ok", message: "no panel feature needs a package the panel lacks." };
      }

      const missing: OptionalPeerMissingError[] = [];
      for (const name of wanted) {
        try {
          await loaders[name]();
        } catch (error) {
          if (!(error instanceof OptionalPeerMissingError)) throw error;
          missing.push(error);
        }
      }
      if (missing.length === 0) {
        return { status: "ok", message: "every package the panel's features use is installed." };
      }
      return {
        status: "fail",
        message: missing
          .map(({ missing: m }) => `${m.feature} needs ${m.peer}, which is not installed.`)
          .join(" "),
        fix: missing.map(({ missing: m }) => m.install).join("\n"),
      };
    },
  };
}
