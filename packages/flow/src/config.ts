import { deepMerge, env } from "@zerotal/core";
import type { MiddlewareClass } from "@zerotal/core";

export interface FlowConfigShape {
  /**
   * Serve the client runtime in CSP-safe mode — no `'unsafe-eval'` required.
   *
   * Costs a little payload and start-up time, so it is off unless you actually
   * ship a Content-Security-Policy without `unsafe-eval`.
   *
   * Default: `false`, or the `ZT_FLOW_CSP_SAFE` / `APP_CSP_SAFE` env flag.
   */
  cspSafe: boolean;
  /**
   * Global middleware re-applied on every WebSocket update (Livewire-style
   * persistent middleware). Entries are matched against the app's global
   * pipeline by class reference or by class name.
   *
   * Route middleware always re-runs and does not need to be listed here.
   *
   * Default: `["SessionMiddleware", "PersistUserMiddleware", "BearerTokenMiddleware"]`
   */
  persistentMiddleware: (string | MiddlewareClass)[];
}

/** Global middleware re-run on every WebSocket action unless overridden. */
export const DEFAULT_PERSISTENT_MIDDLEWARE: (string | MiddlewareClass)[] = [
  "SessionMiddleware",
  "PersistUserMiddleware",
  "BearerTokenMiddleware",
];

const defaults: FlowConfigShape = {
  cspSafe: env("ZT_FLOW_CSP_SAFE", false) || env("APP_CSP_SAFE", false),
  persistentMiddleware: [...DEFAULT_PERSISTENT_MIDDLEWARE],
};

/**
 * @example
 * import { FlowConfig } from '@zerotal/flow';
 * export default FlowConfig({ cspSafe: true });
 */
export function FlowConfig(options: Partial<FlowConfigShape> = {}): FlowConfigShape {
  return deepMerge(defaults, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    flow: FlowConfigShape;
  }
}
