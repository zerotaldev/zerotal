/**
 * One place that answers "is the inspector on, and for whom".
 *
 * Separated from the provider and the middleware because both need the same
 * answer, and two gates that can disagree is how a dev-only surface ends up
 * serving request headers in production.
 *
 * The panel was all-or-nothing on {@link devSurfacesEnabled} until it grew things
 * worth gating: request bodies, session keys, stack traces, the resolved config.
 * That default is still right — a deployed process exposes nothing — but "off
 * everywhere but my laptop" is not the only shape a team needs, and without a
 * supported escape hatch the way you run this on a shared staging box is to lie
 * about `APP_ENV`.
 */
import { config, devSurfacesEnabled } from "@zerotal/core";
import { DevtoolsConfig, type DevtoolsConfigShape } from "./config.ts";

/** The `devtools` config block, with defaults when config is not loaded. */
export function devtoolsSettings(): DevtoolsConfigShape {
  return DevtoolsConfig(config.safe<Partial<DevtoolsConfigShape>>("devtools", {}));
}

/**
 * Whether the inspector should run at all.
 *
 * `enabled: null` (the default) defers to {@link devSurfacesEnabled} — the same
 * gate as the stack-trace error page — so the panel is on under `zt dev` and off
 * in a production deploy without anyone configuring it. An explicit `true` or
 * `false` wins, which is what makes it testable and what lets an app run it on a
 * staging box behind a gate.
 */
export function devtoolsEnabled(): boolean {
  return devtoolsSettings().enabled ?? devSurfacesEnabled();
}

/**
 * Whether this request may reach the inspector's endpoints.
 *
 * A dev process always may — a gate that can lock a developer out of their own
 * machine gets switched off, and then nothing is gated. Anywhere else the app's
 * `gate` decides, and the absence of one is a **refusal** rather than a default
 * allow: an app that turned the inspector on outside development without saying
 * who may read it has not made a decision this code should make for it.
 *
 * One function answers for every endpoint. The SSE stream, the trace JSON, the
 * dashboard, and the panel bundle are the same secret.
 */
export async function devtoolsAuthorized(request: Request): Promise<boolean> {
  if (devSurfacesEnabled()) return true;
  const gate = devtoolsSettings().gate;
  if (!gate) return false;
  try {
    return await gate(request);
  } catch {
    // A gate that throws has not said yes. Failing open here would turn a typo in
    // someone's authorization check into an open trace inspector.
    return false;
  }
}
