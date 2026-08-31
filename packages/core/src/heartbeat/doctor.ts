/**
 * Turning a check-in into a doctor finding, once, for every worker kind.
 *
 * Scheduler and queue have the same question — *is anything actually running
 * this?* — and answering it twice is how two packages come to disagree about
 * what "stale" means.
 *
 * @module
 */
import type { DoctorCheck, DoctorCheckResult } from "../doctor/AppDoctor.ts";
import { Heartbeat, type BeatLookup } from "./Heartbeat.ts";

/** How a lookup reads in a report. */
export function describeBeat(lookup: BeatLookup): string {
  if (lookup.status === "seen") {
    const minutes = Math.round(lookup.ageSeconds / 60);
    if (lookup.ageSeconds < 90) return "checked in just now";
    if (minutes < 90) return `last checked in ${minutes} minutes ago`;
    return `last checked in ${Math.round(minutes / 60)} hours ago`;
  }
  return lookup.status === "never" ? "has never checked in" : lookup.reason;
}

/** What {@link workerLivenessCheck} needs to know about one worker kind. */
export interface WorkerLivenessOptions {
  /** Doctor check id, e.g. `"scheduler-running"`. */
  id: string;
  /** Label, e.g. `"Scheduler"`. */
  label: string;
  /** Heartbeat name, e.g. `"scheduler"`. */
  name: string;
  /**
   * Whether this app has anything for the worker to do.
   *
   * Checked first and separately, because "no worker is running" is only a
   * finding when there is work registered. An app with no schedules and no
   * worker is correctly configured, and saying otherwise is how a doctor becomes
   * a thing people scroll past.
   */
  hasWork(): Promise<{ has: boolean; summary: string }> | { has: boolean; summary: string };
  /** Seconds after which a check-in is stale. */
  staleAfter: number;
  /** What to run to start it, named in the fix. */
  command: string;
}

/**
 * Build a check that reports work registered with nothing running it.
 *
 * The severity ladder is deliberate. Nothing registered is silent. Registered and
 * never seen is a failure — that is the reported production case, where a site
 * ran for weeks with no scheduled task executing. Registered and *stale* is a
 * warning, because a worker that checked in an hour ago and not since may be
 * mid-restart. And "cannot tell" is reported as ok with the reason attached,
 * never as a finding, because a check that cries wolf on the memory cache driver
 * is one people learn to skip.
 */
export function workerLivenessCheck(options: WorkerLivenessOptions): DoctorCheck {
  return {
    id: options.id,
    label: options.label,
    async run(): Promise<DoctorCheckResult> {
      const work = await options.hasWork();
      if (!work.has) return { status: "ok", message: "nothing registered, nothing to run" };

      const seen = await Heartbeat.lastSeen(options.name);

      if (seen.status === "unknown") {
        return { status: "ok", message: `${work.summary} — cannot verify: ${seen.reason}` };
      }

      if (seen.status === "never") {
        return {
          status: "fail",
          message:
            `${work.summary}, and no worker has ever checked in. Nothing is running them. ` +
            `This is silent by nature — the web process has no way to notice, and the work ` +
            `simply does not happen.`,
          fix: `Start the worker process: \`${options.command}\`. It is a second process; the web server does not run this.`,
        };
      }

      if (seen.ageSeconds > options.staleAfter) {
        return {
          status: "warn",
          message: `${work.summary}, and the worker ${describeBeat(seen)}.`,
          fix: `Check the worker process is alive and restart it if not: \`${options.command}\`.`,
        };
      }

      return { status: "ok", message: `${work.summary}, worker ${describeBeat(seen)}` };
    },
  };
}
