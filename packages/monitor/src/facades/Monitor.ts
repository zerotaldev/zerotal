/**
 * The `Monitor` facade — a thin, always-available entry point for feeding the
 * monitoring store from application code. Use it to record data the recorder
 * middleware can't see automatically (SQL queries, outgoing HTTP calls, cache
 * hits, sent mail, deploys):
 *
 *   import { Monitor } from "@zerotal/monitor";
 *   Monitor.recordQuery({ sql, ms, location: "PostController@index" });
 *   Monitor.recordHttp({ host: "api.stripe.com", ms: 412 });
 *   Monitor.recordCache(hit, key);
 *   Monitor.recordMail({ subject, to, mailer, status: "sent", ms, body });
 *
 * Every method is a no-op if the monitor provider hasn't booted, so it's safe
 * to call unconditionally.
 */
import { RequestContext } from "@zerotal/core";
import { _getStore } from "../instance.ts";
import { addContext } from "../recorder/ctxBuffers.ts";
import type { MonitorStore } from "../MonitorStore.ts";

type StoreMethods = Pick<
  MonitorStore,
  | "recordRequest"
  | "recordException"
  | "recordQuery"
  | "recordHttp"
  | "recordCache"
  | "recordMail"
  | "recordDeploy"
  | "recordJob"
  | "snapshot"
>;

function call<K extends keyof StoreMethods>(
  method: K,
  ...args: Parameters<StoreMethods[K]>
): ReturnType<StoreMethods[K]> | undefined {
  const store = _getStore();
  if (!store) return undefined;

  return (store[method] as (...a: unknown[]) => unknown)(...args) as ReturnType<StoreMethods[K]>;
}

export const Monitor = {
  recordRequest: (...a: Parameters<MonitorStore["recordRequest"]>) => call("recordRequest", ...a),
  recordException: (...a: Parameters<MonitorStore["recordException"]>) =>
    call("recordException", ...a),
  recordQuery: (...a: Parameters<MonitorStore["recordQuery"]>) => call("recordQuery", ...a),
  recordHttp: (...a: Parameters<MonitorStore["recordHttp"]>) => call("recordHttp", ...a),
  recordCache: (...a: Parameters<MonitorStore["recordCache"]>) => call("recordCache", ...a),
  recordMail: (...a: Parameters<MonitorStore["recordMail"]>) => call("recordMail", ...a),
  recordDeploy: (...a: Parameters<MonitorStore["recordDeploy"]>) => call("recordDeploy", ...a),
  recordJob: (...a: Parameters<MonitorStore["recordJob"]>) => call("recordJob", ...a),
  /**
   * Attach custom metadata to the current request or Flow action so it shows on
   * the trace — tenant, plan, feature flags, anything useful for debugging:
   *
   *   Monitor.context({ tenant: tenant.id, plan: user.plan });
   *
   * No-op outside a request/action scope.
   */
  context(data: Record<string, unknown>): void {
    const ctx = RequestContext.tryGet();
    if (ctx) addContext(ctx as object, data);
  },
  /** Read the current aggregated snapshot (used by the page; rarely needed directly). */
  snapshot: (...a: Parameters<MonitorStore["snapshot"]>) => {
    const store = _getStore();
    return store ? store.snapshot(...a) : undefined;
  },
  /** The live store instance, if booted. */
  get store(): MonitorStore | undefined {
    return _getStore();
  },
} as const;
