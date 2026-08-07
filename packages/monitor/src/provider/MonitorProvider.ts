/**
 * Wires `@zerotal/monitor` into a Zerotal app:
 *
 *   1. Resolves `config/monitor.ts` (with defaults) and binds it as `monitor`.
 *   2. Creates the {@link MonitorStore}, binds it to the IoC container and the
 *      live app (so it can read queue/scheduler/health), and publishes it via
 *      the process handle used by the recorder and the `Monitor` facade.
 *   3. Installs the event-driven recorder (when `record: true`).
 *   4. Registers the Flow panel route at `config.path` behind the auth guard.
 *
 * The panel is a Flow component, so this provider depends on `FlowProvider`
 * (declared via `dependsOn`) — it is registered and booted automatically, in the
 * right order, even in apps that don't otherwise use Flow:
 *
 *   import { MonitorProvider } from "@zerotal/monitor";
 *   const providers = [MonitorProvider]; // FlowProvider comes along via dependsOn
 */
import { ServiceProvider, Router } from "@zerotal/core";
import { FlowProvider } from "@zerotal/flow";
import type { AppEnvironment, HttpContext } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import type { MonitorRange } from "../store/types.ts";
import { LogManager, frameworkLog } from "@zerotal/core/logger";
import { MonitorConfig, type ResolvedMonitorConfig } from "../config.ts";
import { MonitorStore } from "../MonitorStore.ts";
import { _setStore } from "../instance.ts";
import { installMonitorEventBridge } from "../recorder/MonitorEventBridge.ts";
import { renderPrometheus } from "../prometheus.ts";
import { evaluateAlerts, alertsToFire, _dispatchAlert, onAlert } from "../alerting.ts";
import { detectDeploy } from "../sources/system.ts";
import { MonitorAuthMiddleware } from "../middleware/MonitorAuthMiddleware.ts";
import { MonitorPanel } from "../panel.ts";
import type { MonitorPanelHost } from "../panel.ts";
import { MonitorPayloadMiddleware } from "../middleware/MonitorPayloadMiddleware.ts";
import { MonitorPage } from "../ui/MonitorPage.tsx";

declare module "@zerotal/core" {
  interface ContainerBindings {
    monitor: ResolvedMonitorConfig;
    "monitor.store": MonitorStore;
    /** The panel's contribution surface — see `panel.ts`. */
    "monitor.panel": MonitorPanelHost;
  }
}

export class MonitorProvider extends ServiceProvider {
  static override provides = ["monitor", "monitor.store", "monitor.panel"] as const;
  // The panel mounts via Flow's `Router.flow()` macro, so FlowProvider must
  // register/boot first to install it. Declaring the dependency wires it in
  // automatically (and in order) even in non-Flow apps.
  static override dependsOn = [FlowProvider];
  // The panel + metrics endpoints mount via Flow's `Router.flow()` macro and the
  // HTTP router, so this only runs where Flow/the server do — not in `console`
  // (CLI) boots, where the macro is absent and there's nothing to serve.
  static override environments: AppEnvironment[] = ["web", "test"];

  private _disposeBridge: (() => void) | undefined = undefined;
  private _disposeLogTap: (() => void) | undefined = undefined;
  private _pruneTimer: ReturnType<typeof setInterval> | undefined = undefined;
  private _alertTimer: ReturnType<typeof setInterval> | undefined = undefined;
  private _disposeAlertHook: (() => void) | undefined = undefined;
  private readonly _firingAlerts = new Set<string>();
  private readonly _lastFiredAt = new Map<string, number>();

  override onRegister(): void {
    this.app.container.singleton("monitor", () => {
      const config = this.app.container.makeSync("config") as ConfigManager;
      const raw = config.get<ResolvedMonitorConfig>("monitor");
      // Apply defaults even if the app didn't author config/monitor.ts.
      return raw ? MonitorConfig(raw) : MonitorConfig();
    });

    // Publish the contribution surface during registration, so any provider can
    // add a section from its own `onBooting` regardless of boot order —
    // contributors deliberately do not (and must not) depend on this package.
    //
    // The factory body runs on first resolution, not now: reading config during
    // the registration phase would force it earlier than the rest of the provider
    // needs it, and isolated tests bind no config at all.
    this.app.container.singleton("monitor.panel", () => {
      try {
        const cfg = this.app.container.makeSync("monitor") as ResolvedMonitorConfig;
        MonitorPanel.configure(cfg.sections);
      } catch {
        // No config bound — every contributor stays enabled.
      }
      return MonitorPanel.host();
    });

    this.app.container.singleton("monitor.store", () => {
      const cfg = this.app.container.makeSync("monitor") as ResolvedMonitorConfig;
      const deploy = cfg.deploy ?? detectDeploy();
      const store = new MonitorStore({
        apdexTargetMs: cfg.apdexTargetMs,
        slowQueryMs: cfg.slowQueryMs,
        slowRequestMs: cfg.slowRequestMs,
        snapshotCacheMs: cfg.snapshotCacheMs,
        storage: cfg.storage,
        retentionDays: cfg.retentionDays,
        retentionMode: cfg.retentionMode,
        ...(cfg.zerotalVersion ? { zerotalVersion: cfg.zerotalVersion } : {}),
        ...(cfg.region ? { region: cfg.region } : {}),
        ...(deploy ? { deploy } : {}),
      });
      return store;
    });
  }

  override async onBooting(): Promise<void> {
    const cfg = (await this.app.container.make("monitor")) as ResolvedMonitorConfig;
    const store = (await this.app.container.make("monitor.store")) as MonitorStore;

    // Let the store reach the live subsystems, and publish it process-wide.
    store.bindApp(this.app as unknown as { container: { tryMake(name: string): unknown } });
    _setStore(store);

    // Expose branding/refresh/path/retention to the page without a container round-trip.
    (globalThis as { __monitorConfig?: unknown }).__monitorConfig = {
      title: cfg.title,
      subtitle: cfg.subtitle,
      refreshMs: cfg.refreshMs,
      path: cfg.path.replace(/\/$/, "") || "/monitor",
      retentionDays: cfg.retentionDays,
      retentionMode: cfg.retentionMode,
    };

    // Opt-in: capture request/response headers + bodies for the request trace.
    if (cfg.record && cfg.capturePayloads) {
      this.app.use(MonitorPayloadMiddleware);
    }

    // Install the recorder: one FrameworkEvents bridge feeds every panel
    // (requests + queries + cache + mail + exceptions + outgoing HTTP + jobs).
    if (cfg.record) {
      this._disposeBridge = installMonitorEventBridge(store);

      // Surface application logs in the panel via a LogManager tap.
      this._disposeLogTap = LogManager.tap((entry) => {
        const status =
          entry.level === "error" || entry.level === "fatal"
            ? "bad"
            : entry.level === "warn"
              ? "warn"
              : "info";
        store.recordEvent({
          kind: "log",
          label: entry.level,
          status,
          route: entry.requestId ?? null,
          data: {
            detail: entry.message,
            ...(entry.error ? { error: entry.error } : {}),
            ...entry.context,
          },
        });
      });
    }

    // Enforce retention: prune past-window data now and hourly thereafter.
    store.prune();
    this._pruneTimer = setInterval(() => store.prune(), 60 * 60 * 1000);
    (this._pruneTimer as { unref?: () => void }).unref?.();

    // Evaluate threshold alerts every 15s (edge-triggered, deduped).
    if (cfg.alerts) {
      this._alertTimer = setInterval(() => void this._runAlerts(store, cfg), 15_000);
      (this._alertTimer as { unref?: () => void }).unref?.();

      // Ship newly-firing alerts to a webhook so they page someone, not just the panel.
      if (cfg.alertWebhook) {
        const webhook = cfg.alertWebhook;
        this._disposeAlertHook = onAlert(async (a) => {
          try {
            await fetch(webhook, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: `[${a.level.toUpperCase()}] ${a.title} — ${a.detail}`,
                level: a.level,
                title: a.title,
                detail: a.detail,
              }),
            });
          } catch {
            /* delivery is best-effort — never throw back into the alert loop */
          }
        });
      }
    }

    // Mount the panel. The base path renders the Overview; `/:section` deep-links
    // each page (e.g. /monitor/requests, /monitor/exceptions) to the same shell.
    const path = cfg.path.replace(/\/$/, "") || "/monitor";
    Router.flow(path, MonitorPage, [MonitorAuthMiddleware]);
    Router.flow(`${path}/:section`, MonitorPage, [MonitorAuthMiddleware]);

    // Snapshot export — the full derived snapshot as a JSON download, behind the
    // same auth gate as the panel. `?range=live|1h|24h|7d` selects the window.
    Router.get(
      `${path}/export.json`,
      async (http: HttpContext) => {
        const q = http.query("range", "live") ?? "live";
        const range: MonitorRange = (["live", "1h", "24h", "7d"] as const).includes(
          q as MonitorRange,
        )
          ? (q as MonitorRange)
          : "live";
        const snap = await store.snapshot(range);
        return new Response(JSON.stringify(snap, null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="zerotal-monitor-${range}.json"`,
          },
        });
      },
      [MonitorAuthMiddleware],
    );

    // Prometheus text-exposition endpoint (protect at the network layer).
    if (cfg.metrics) {
      Router.get(cfg.metricsPath, async () => {
        const snap = await store.snapshot("live");
        return new Response(renderPrometheus(snap), {
          headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
        });
      });
    }
  }

  /** Evaluate alerts against a live snapshot; fire newly-breaching ones, reset resolved. */
  private async _runAlerts(store: MonitorStore, cfg: ResolvedMonitorConfig): Promise<void> {
    try {
      const snap = await store.snapshot("live");
      const active = evaluateAlerts(snap, cfg.alertThresholds);
      const activeIds = new Set(active.map((a) => a.id));

      // Edge-triggered + cooldown: fire each newly-breaching alert once, and don't
      // re-fire within the cooldown even if it recovers and re-breaches.
      const toFire = alertsToFire(
        active,
        this._firingAlerts,
        this._lastFiredAt,
        Date.now(),
        cfg.alertCooldownMs,
      );
      for (const a of toFire) {
        frameworkLog("monitor").warn(`ALERT [${a.level}] ${a.title} — ${a.detail}`, {
          level: a.level,
        });
        store.recordEvent({
          kind: "alert",
          label: a.title,
          status: a.level === "critical" ? "bad" : "warn",
          route: a.id,
          // Capture the metric + a snapshot of the surrounding state so the panel can
          // explain *why* it fired without the operator hunting across tabs.
          data: {
            id: a.id,
            level: a.level,
            detail: a.detail,
            metric: a.metric,
            value: a.value,
            threshold: a.threshold,
            unit: a.unit,
            context: this._alertContext(snap),
          },
        });
        _dispatchAlert(a);
      }
      // Reset alerts that have recovered so they can fire again next time.
      for (const id of [...this._firingAlerts]) {
        if (!activeIds.has(id)) this._firingAlerts.delete(id);
      }
    } catch {
      /* alerting must never break the app */
    }
  }

  /** A compact snapshot of the surrounding state, recorded with each alert firing. */
  private _alertContext(
    snap: import("../store/types.ts").MonitorSnapshot,
  ): Record<string, unknown> {
    const errCard = snap.statCards.find((c) => c.label === "Error rate");
    const rpmCard = snap.statCards.find((c) => c.label === "Requests / min");
    const pct = (label: string): number =>
      snap.percentiles.find((p) => p.label === label)?.value ?? 0;
    return {
      errorRate: errCard ? parseFloat(errCard.value) || 0 : 0,
      rpm: rpmCard ? parseFloat(rpmCard.value.replace(/,/g, "")) || 0 : 0,
      p50: pct("p50"),
      p95: pct("p95"),
      p99: pct("p99"),
      apdex: snap.apdex,
      pending: snap.queues.reduce((acc, q) => acc + q.pending, 0),
      rolledBack: snap.transactions.rolledBack,
      slowRoutes: snap.slowRoutes
        .slice(0, 3)
        .map((r) => ({ method: r.method, path: r.path, ms: r.ms })),
      topException: snap.exceptions[0]?.type ?? null,
    };
  }

  override async onStopping(): Promise<void> {
    if (this._pruneTimer) clearInterval(this._pruneTimer);
    this._pruneTimer = undefined;
    if (this._alertTimer) clearInterval(this._alertTimer);
    this._alertTimer = undefined;
    this._disposeAlertHook?.();
    this._disposeAlertHook = undefined;
    this._disposeBridge?.();
    this._disposeBridge = undefined;
    this._disposeLogTap?.();
    this._disposeLogTap = undefined;
    const store = this.app.container.tryMake("monitor.store") as MonitorStore | null;
    store?.dispose();
    _setStore(undefined);
  }
}
