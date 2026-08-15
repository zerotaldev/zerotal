/**
 * One place that answers "is the recorder on, and for whom".
 *
 * Separated from the middleware and the read API because both need the same
 * answer, and two gates that can disagree is how a dev-only surface ends up
 * serving request headers in production.
 */
import { config, devSurfacesEnabled } from "@zerotal/core";
import type { InertiaDevtoolsConfig } from "../config.ts";
import { DEVTOOLS_API_PREFIX } from "./types.ts";

const FALLBACK: InertiaDevtoolsConfig = {
  enabled: null,
  maxEntries: 200,
  redact: [],
  redactHeaders: [],
  except: [],
  gate: null,
};

/** The `inertia.devtools` config block, with defaults when config is not loaded. */
export function devtoolsSettings(): InertiaDevtoolsConfig {
  return { ...FALLBACK, ...config.safe("inertia.devtools", FALLBACK) };
}

/**
 * Whether the recorder should run at all.
 *
 * `enabled: null` (the default) defers to `devSurfacesEnabled()` — the same gate
 * as the stack-trace error page — so the recorder is on under `zt dev` and off
 * in a production deploy without anyone configuring it. An explicit `true` or
 * `false` wins, which is what makes the recorder testable and what lets an app
 * run it on a staging box behind a gate.
 */
export function devtoolsEnabled(): boolean {
  return devtoolsSettings().enabled ?? devSurfacesEnabled();
}

/**
 * Whether this path is recorded.
 *
 * The read API always excludes itself: the extension polls it, and recording
 * those polls would fill the timeline with the act of reading the timeline.
 */
export function isRecordablePath(pathname: string): boolean {
  if (pathname.startsWith(DEVTOOLS_API_PREFIX)) return false;
  return !devtoolsSettings().except.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Whether this request may read the recorded entries.
 *
 * A dev process always may — a gate that can lock a developer out of their own
 * machine gets switched off, and then nothing is gated. Anywhere else the app's
 * `gate` decides, and the absence of one is a refusal rather than a default
 * allow: an app that turned the recorder on in production without saying who
 * may read it has not made a decision this code should make for it.
 */
export async function devtoolsAuthorized(request: Request): Promise<boolean> {
  if (devSurfacesEnabled()) return true;
  const gate = devtoolsSettings().gate;
  if (!gate) return false;
  return await gate(request);
}
