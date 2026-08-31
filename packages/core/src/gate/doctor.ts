/**
 * The doctor check for a gate that is still up.
 *
 * A site gate is the most reversible thing in the framework and the easiest to
 * forget, because when it is working nothing complains: the people who would
 * notice are the ones being kept out, and they have no way to tell you. Trekly's
 * report describes the same shape from the other side — a `basic_auth` block
 * held out of version control precisely so it could not be forgotten into
 * production, which is a workaround for the absence of this check.
 *
 * @module
 */
import type { Application } from "../application/Application.ts";
import { deployEnv, isProdLike } from "../support/env.ts";
import type { DoctorCheck, DoctorCheckResult } from "../doctor/AppDoctor.ts";
import { gateExpired, readGate } from "./state.ts";

/**
 * Report a site that is not open, and say how long it has been that way.
 *
 * Severity is by mode and environment, because the same state means different
 * things. Maintenance in production is an outage and is reported as a failure.
 * A preview in production is usually deliberate — a pre-launch site — so it is a
 * warning that names the date rather than an error. A gate in development is
 * neither, and saying nothing there is what keeps the check worth reading.
 */
export const siteGateCheck: DoctorCheck = {
  id: "site-gate",
  label: "Site gate",
  run(_app: Application): DoctorCheckResult {
    const state = readGate();
    if (!state) return { status: "ok", message: "site is open" };

    // The deployment environment, not the boot mode — `app._env` is web/worker/
    // console and would never equal "production".
    const production = isProdLike(deployEnv());
    const since = state.since.slice(0, 10);
    const who = state.by ? `, set by ${state.by}` : "";

    if (state.mode === "preview" && gateExpired(state)) {
      // Worth its own finding: the file says the site is gated and the gate is
      // no longer gating, so what a reader believes and what visitors get have
      // come apart.
      return {
        status: "warn",
        message:
          `A private preview's window closed on ${state.until} — the site has been public ` +
          `since then, while the gate file still says otherwise.`,
        fix: "Run `bun zt up` to clear it, or `bun zt preview --until=<date>` to extend it.",
      };
    }

    if (state.mode === "maintenance") {
      return {
        status: production ? "fail" : "warn",
        message:
          `The site is in maintenance mode${who}, since ${since}. Every request is answered ` +
          `503${production ? " — in production, this is an outage" : ""}.`,
        fix: "Run `bun zt up` when the work is finished.",
      };
    }

    return {
      status: production ? "warn" : "ok",
      message:
        `The site is in private preview${who}, since ${since}` +
        `${state.until ? `, until ${state.until}` : " with no end date"}. The public cannot see it.` +
        `${state.until ? "" : " A preview with no end date is the kind that outlives its purpose."}`,
      fix: "Run `bun zt up` to make it public, or `bun zt gate:status` to see the details.",
    };
  },
};
