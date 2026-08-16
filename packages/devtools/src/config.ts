import { deepMerge } from "@zerotal/core";
import type { RedactionOptions } from "./redaction.ts";
import type { EditorName } from "./editor.ts";

/**
 * Decides whether a request may reach the inspector outside a development
 * process. Returning anything but `true` is a refusal.
 */
export type DevtoolsGate = (request: Request) => boolean | Promise<boolean>;

export interface DevtoolsConfigShape {
  /**
   * Whether the inspector runs at all.
   *
   * `null` (the default) follows the same dev-surface gate as the stack-trace
   * error page: on under `zt dev`, off in a deployed process. `true` or `false`
   * decides explicitly — and `true` outside development requires a {@link gate},
   * because the absence of one is a refusal rather than a default allow.
   */
  enabled: boolean | null;
  /**
   * Who may read the inspector outside a development process.
   *
   * Never consulted on a development machine: a gate that can lock you out of
   * your own laptop is a gate that gets switched off, and then nothing is gated.
   * One function answers for every endpoint — the stream, the trace JSON, the
   * dashboard, and the panel bundle are the same secret.
   *
   * @example
   * gate: (request) => request.headers.get("X-Debug-Key") === Bun.env["DEBUG_KEY"],
   */
  gate: DevtoolsGate | null;
  /**
   * How many request traces to keep in memory and reload on start.
   * Default: `100`.
   */
  capacity: number;
  /**
   * SQLite file backing the trace history, so it survives a restart. Set to
   * `null` to keep traces in memory only — nothing is written to disk.
   * Default: `.zerotal/devtools.sqlite`, or `ZT_DEVTOOLS_DB`.
   */
  dbPath: string | null;
  /**
   * How long a persisted trace survives, in hours.
   * Default: `24`, or `ZT_DEVTOOLS_PRUNE_HOURS`.
   */
  pruneHours: number;
  /**
   * Whether sensitive values are masked before a trace leaves the process.
   *
   * On by default: a trace is streamed to the browser *and* written to disk for
   * a day, and what it carries is the request's real values — the password on a
   * registration, a reset token, every customer email a listing selects by.
   * Turn it off only when you are debugging the values themselves.
   */
  redact: RedactionOptions;
  /**
   * Which editor `file:line` links open.
   *
   * Every location the panel shows becomes a link: a query's call site, a log
   * line's, a stack frame, a prop's render source. Going from "this query is
   * slow" to the line that ran it is the most frequent move in a debugging
   * session, and it was two manual searches.
   *
   * Default: `vscode`. Set to `null` to render locations as plain text.
   */
  editor: EditorName | null;
  /**
   * Rewrite a captured path before it becomes a link — for editing on a machine
   * that is not the one running the code.
   *
   * Keys are path prefixes as the *server* sees them; values are what your editor
   * should open instead. A container reporting `/app/src/Foo.ts` maps home with
   * `{ "/app": "/Users/you/project" }`.
   */
  editorPathMap: Record<string, string>;
  /**
   * Capture the application call site for each query and log line.
   *
   * "Which of my 40 queries is slow" was answerable; "where do I go to fix it"
   * was not. One stack walk per recorded event, filtered to application frames —
   * measured at roughly two microseconds regardless of stack depth, so about
   * 0.08ms on a request running forty queries.
   *
   * Default: on. It only ever runs when the inspector itself is running.
   */
  captureSource: boolean;
  /**
   * Extra request headers to record, on top of the built-in safe list.
   *
   * The allowlist exists because a trace is persisted: `cookie` and
   * `authorization` are the request's credentials. This opens up the ones you
   * are actually debugging — matched case-insensitively, and `"*"` records every
   * header except those `redact` masks.
   */
  headers: string[];
}

const defaults: DevtoolsConfigShape = {
  enabled: null,
  gate: null,
  capacity: 100,
  dbPath: Bun.env["ZT_DEVTOOLS_DB"] ?? ".zerotal/devtools.sqlite",
  pruneHours: Number(Bun.env["ZT_DEVTOOLS_PRUNE_HOURS"] ?? 24),
  redact: { enabled: true, allow: [], deny: [] },
  editor: "vscode",
  editorPathMap: {},
  captureSource: true,
  headers: [],
};

/**
 * Create a typed devtools configuration object with defaults.
 *
 * @example
 * // config/devtools.ts
 * import { DevtoolsConfig } from '@zerotal/devtools';
 *
 * export default DevtoolsConfig({
 *   capacity: 250,
 *   editor: 'cursor',
 *   redact: { allow: ['email', 'slug'] },
 * });
 */
export function DevtoolsConfig(options: Partial<DevtoolsConfigShape> = {}): DevtoolsConfigShape {
  return deepMerge(defaults, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    devtools: DevtoolsConfigShape;
  }
}
