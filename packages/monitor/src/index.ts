/**
 * `@zerotal/monitor` — a production monitoring & queue dashboard for Zerotal.
 *
 * A server-driven Flow panel ("Super Panel") with eight tabs: Overview,
 * Requests, Exceptions, Queues, Mail, Database, Cache and System. It records
 * live request/exception data via middleware, reads queues/scheduler/health
 * from the running app, and exposes a `Monitor` facade for everything else.
 *
 * @example
 * // bootstrap/providers.ts
 * import { FlowProvider } from "@zerotal/flow";
 * import { MonitorProvider } from "@zerotal/monitor";
 * export default [FlowProvider, MonitorProvider];
 *
 * @example
 * // config/monitor.ts
 * import { MonitorConfig } from "@zerotal/monitor";
 * export default MonitorConfig({ path: "/monitor", auth: (u) => u?.role === "admin" });
 */

// Provider + config
export { MonitorProvider } from "./provider/MonitorProvider.ts";
export { MonitorConfig } from "./config.ts";
export type { MonitorConfigShape, ResolvedMonitorConfig } from "./config.ts";

// Facade + store
export { Monitor } from "./facades/Monitor.ts";
export { MonitorStore } from "./MonitorStore.ts";
export type { MonitorStoreOptions } from "./MonitorStore.ts";

// Prometheus exporter
export { renderPrometheus } from "./prometheus.ts";

// Alerting
export { evaluateAlerts, onAlert } from "./alerting.ts";
export type { AlertThresholds, AlertNotice } from "./alerting.ts";

// Recorder + guard
export { installMonitorEventBridge } from "./recorder/MonitorEventBridge.ts";
export { MonitorAuthMiddleware } from "./middleware/MonitorAuthMiddleware.ts";
export { MonitorPayloadMiddleware } from "./middleware/MonitorPayloadMiddleware.ts";

// UI
// The contribution surface. Packages push into the `monitor.panel` binding
// rather than importing these types; they're exported for app-authored sections.
export { MonitorPanel } from "./panel.ts";
export type {
  MonitorPanelHost,
  MonitorSection,
  MonitorSectionData,
  MonitorStat,
  MonitorTable,
  MonitorTableColumn,
  MonitorTone,
  MonitorRow,
} from "./panel.ts";

export { MonitorPage } from "./ui/MonitorPage.tsx";
export { MonitorLayout } from "./ui/MonitorLayout.tsx";

// Data shapes
export type * from "./store/types.ts";
