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
   * Global middleware re-applied on every WebSocket update (persistent
   * middleware). Entries are matched against the app's global
   * pipeline by class reference or by class name.
   *
   * Route middleware always re-runs and does not need to be listed here.
   *
   * Default: `["SessionMiddleware", "PersistUserMiddleware", "BearerTokenMiddleware"]`
   */
  persistentMiddleware: (string | MiddlewareClass)[];
  /**
   * Whether a visitor is shown an error's own message when something on a Flow page throws:
   * the toast the default `onError()` raises, and the message of the error frame the browser
   * logs.
   *
   * An error's text is written for the log. It can name tables, hosts and file paths, so
   * outside development and tests the visitor is told "Something went wrong. Please try
   * again." and the detail goes to the log and the app's exception handler. An error the
   * framework raised to answer the client (`abort(403, "…")`, a `ForbiddenError`) keeps its
   * message either way.
   *
   * `true` shows every message everywhere, which is what Flow did before 1.18.4. `false` hides
   * them everywhere, development included.
   *
   * Default: unset, which means shown in development, under `bun zt dev` and in tests, and
   * hidden everywhere else.
   */
  exposeErrorMessages?: boolean | undefined;
  /**
   * Uploads through `<FileUpload>` and `flow:model` on a file input.
   *
   * `maxBytes` is the largest request body the upload endpoint accepts. It counts the whole
   * multipart body, so the largest file is a little under it. Unset, the endpoint is held to
   * `app.maxRequestBodySize` like every other route (8 MiB unless you change it), and a single
   * file over 25 MB is refused whatever that is.
   *
   * Default: unset.
   */
  uploads?: { maxBytes?: number | undefined } | undefined;
}

/**
 * Global middleware re-run on every WebSocket action unless overridden.
 *
 * @internal
 */
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
