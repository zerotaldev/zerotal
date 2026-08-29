// ── Core shared types for @zerotal/flow ────────────────────────────────────────
//
// The wire-format types that round-trip between server and client: the serialized
// component snapshot, the inbound `call` frame, and the outbound server frames
// (`patch`, `flash`, `redirect`, `error`, …).

/**
 * A single serialized property: `[value, synthMetadata]`.
 * @category Snapshot
 */
export type SnapshotTuple = [data: unknown, meta: Record<string, unknown>];

/**
 * The "data" map inside a snapshot: `propertyName → [value, meta]`.
 * @category Snapshot
 *
 * @internal
 */
export type SnapshotData = Record<string, SnapshotTuple>;

/**
 * Metadata for a child Component component embedded inside a parent's render output.
 * Stored in memo.children (excluded from HMAC signing).
 * @category Snapshot
 *
 * @internal
 */
export interface ChildMemo {
  /** The JSX `key` prop that identifies this slot in the parent's template. */
  key: string;
  /** Stable component ID (data-flow-id on the [data-flow-root] element). */
  id: string;
  /** Child class name — used to route WebSocket actions. */
  name: string;
}

/**
 * Component identity / routing metadata embedded in the snapshot.
 * @category Snapshot
 *
 * @internal
 */
export interface SnapshotMemo {
  id: string;
  name: string;
  path: string;
  children: string[];
  /** @on listener map: eventName → methodName. Excluded from HMAC (server-derived). */
  listeners?: Record<string, string> | undefined;
  /**
   * Named slot HTML passed down by the parent's template (`slotName → html`; the
   * default slot is keyed `"default"`). Rendered in the parent's scope, then carried
   * in the child's snapshot so the child can re-render its own actions with the slot
   * content intact. Signed (server-generated, never trusted from the client).
   */
  slots?: Record<string, string> | undefined;
  /**
   * `@presence` props → their resolved channel, so the client subscribes to the right
   * presence channel(s) and refreshes the member list on join/leave. Signed (the channel
   * is server-resolved from the component, not trusted from the client).
   */
  presence?: Array<{ prop: string; channel: string }> | undefined;
  /**
   * `@shared` props → their resolved channel, so the client subscribes and dispatches
   * `$shared` (re-read the room store + re-render) when the channel signals a change.
   * Signed (server-resolved from the component, not trusted from the client).
   */
  shared?: Array<{ prop: string; channel: string }> | undefined;
  /**
   * The authenticated user this snapshot was issued to, or `undefined` when it was issued
   * to an anonymous request. Signed, and checked on every hydrate.
   *
   * The HMAC proves a snapshot has not been *tampered with*; it says nothing about who it
   * belongs to. Without this binding, `@locked accountId = 42` — documented as tamper-proof
   * server-authoritative state — could be replayed verbatim by any other authenticated
   * user who obtained a snapshot signed for someone else, with the framework's own
   * signature vouching for it. Middleware still re-runs, so auth is re-checked; the data is
   * what the snapshot says.
   */
  sub?: string | undefined;
  /**
   * Issue time, epoch seconds. Signed, and checked on every hydrate against
   * `SNAPSHOT_MAX_AGE_SECONDS` so a captured snapshot is not valid indefinitely.
   */
  iat?: number | undefined;
}

/**
 * The full snapshot that round-trips between server and client.
 * @category Snapshot
 */
export interface Snapshot {
  data: SnapshotData;
  memo: SnapshotMemo;
  checksum: string;
}

/**
 * Outbound WS frame sent by the client to the server.
 * @category Frames
 *
 * @internal
 */
export interface CallFrame {
  type: "call";
  component: string;
  method: string;
  args: unknown[];
  updates: Record<string, unknown>;
  snapshot: Snapshot;
}

/**
 * Patch frame sent by the server to the client after a successful action.
 *
 * The snapshot travels as a **delta** by default: only changed fields (`dataDelta`)
 * and removed keys (`dataRemoved`) are sent, alongside the new `memo` and full-snapshot
 * `checksum`. The client rebuilds the full snapshot from its prior copy + the delta (an
 * exact reconstruction, since the server diffed against the client's own snapshot). The
 * legacy `snapshot` field remains as a full fallback. `html` is omitted when the
 * re-render is byte-identical to the last patch on this connection (HTML suppression).
 * @category Frames
 *
 * @internal
 */
export interface PatchFrame {
  type: "patch";
  component: string;
  html?: string;
  // Delta encoding (default on WebSocket patches):
  memo?: SnapshotMemo;
  checksum?: string;
  dataDelta?: SnapshotData;
  dataRemoved?: string[];
  // Full snapshot — legacy/fallback path (e.g. when there is no client base to diff against).
  snapshot?: Snapshot;
  scripts?: string[];
  errors?: Record<string, string[]>;
  title?: string;
  /** True when the action (or a rejected client write) failed — drives `showOnError`. */
  actionError?: boolean;
  /**
   * True for a mid-`@task` streaming patch: the client applies the DOM/snapshot but keeps the
   * triggering action's loading state on and does not release the per-component send queue —
   * only the final (non-partial) patch does. Absent on ordinary patches.
   */
  partial?: boolean;
}

/**
 * Where a toast is anchored on screen.
 * @category Flash
 */
export type FlashPosition =
  "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center";

/**
 * Button fill style.
 * @category Flash
 */
export type FlashActionVariant = "solid" | "soft" | "ghost";

/**
 * Constrained, inline styling for a toast action button. Kept to a small,
 * purge-proof set (toasts are built at runtime, so arbitrary Tailwind classes
 * would be stripped) — pick a `color`, a fill `variant`, and/or `uppercase`.
 * @category Flash
 */
export interface FlashActionStyle {
  /** Accent: a level name (`success`/`error`/`warning`/`info`), `neutral`, or any CSS color. */
  color?: string;
  /** Fill style — `soft` (default), `solid`, or `ghost`. */
  variant?: FlashActionVariant;
  /** Render the label uppercase (adds letter-spacing). */
  uppercase?: boolean;
}

/**
 * An interactive button inside a toast. `method` names a `@expose` action on the
 * component that emitted the flash; clicking the button invokes it over the WS
 * bridge (with optional `args`), then dismisses the toast.
 * @category Flash
 */
export interface FlashAction extends FlashActionStyle {
  label: string;
  method: string;
  args?: unknown[];
}

/**
 * A `@expose` method (+ args) invoked when the toast is dismissed.
 * @category Flash
 */
export interface FlashCallback {
  method: string;
  args?: unknown[];
}

/**
 * A flash notification payload (server → client). `message`/`level` are the core;
 * everything else is an optional per-toast override of the `<Flash>` defaults.
 * @category Flash
 */
export interface FlashMessage {
  message: string;
  level: "success" | "error" | "warning" | "info";
  /** Bold header rendered above the message. */
  title?: string;
  /** Override the `<Flash>` container position for this toast. */
  position?: FlashPosition;
  /** Auto-dismiss after N ms. `0` (or negative) keeps it until dismissed. */
  duration?: number;
  /** Render a close (×) button. Forced on when the toast doesn't auto-dismiss. */
  dismissible?: boolean;
  /** Custom icon (emoji/text), or `false` to hide the status icon. */
  icon?: string | false;
  /** Show a countdown progress bar (only meaningful while auto-dismissing). */
  progressBar?: boolean;
  /** Action buttons (e.g. "Undo") that each invoke a `@expose` method on click. */
  actions?: FlashAction[];
  /** A `@expose` method invoked when the toast is dismissed (any path). */
  onClose?: FlashCallback;
}

/**
 * Flash notification frame.
 * @category Frames
 *
 * @internal
 */
export interface FlashFrame extends FlashMessage {
  type: "flash";
}

/**
 * Programmatic redirect frame.
 * @category Frames
 *
 * @internal
 */
export interface RedirectFrame {
  type: "redirect";
  url: string;
  sessionToken?: string;
}

/**
 * Error frame (action threw, onError ran).
 * @category Frames
 *
 * @internal
 */
export interface ErrorFrame {
  type: "error";
  component: string;
  message: string;
  /**
   * Dev-only error detail — the server attaches these only under the `serve --dev` worker so the
   * client can render a full-screen error overlay. Never sent in production (no stack leak).
   */
  name?: string;
  stack?: string;
  action?: string;
}

/**
 * Stream frame.
 * @category Frames
 */
export interface StreamFrame {
  type: "stream";
  ref: string;
  content: string;
  replace: boolean;
}

/**
 * Cross-component event frame.
 * @category Frames
 *
 * @internal
 */
export interface EventFrame {
  type: "event";
  name: string;
  data: Record<string, unknown>;
}

/**
 * File download frame.
 * @category Frames
 *
 * @internal
 */
export interface DownloadFrame {
  type: "download";
  filename: string;
  content: string;
  mime: string;
}

/**
 * Sent after WS actions that mutated @session props; the client fetches the relay endpoint.
 * @category Frames
 */
export interface SessionFrame {
  type: "session";
  token: string;
}

/**
 * Sent when the WS connection opens; `dev` enables client-side fast refresh on reconnect.
 * @category Frames
 */
export interface ReadyFrame {
  type: "ready";
  dev?: boolean;
}

/**
 * Union of every frame the server can push to the client over the WebSocket bridge.
 * @category Frames
 */
export type ServerFrame =
  | PatchFrame
  | FlashFrame
  | RedirectFrame
  | ErrorFrame
  | StreamFrame
  | EventFrame
  | DownloadFrame
  | SessionFrame
  | ReadyFrame;

export type FlashLevel = FlashMessage["level"];
