/**
 * Flow's realtime **framework** events, emitted on core's {@link FrameworkEvents}
 * bus (distinct from the app-facing `FlowEvents` realtime contract in
 * `./events.ts`). Observability packages subscribe to them by kind (their class name).
 */

/**
 * Emitted when a Flow (reactive SSR) WebSocket connection opens.
 * @category Realtime
 */
export class WebSocketConnected {
  constructor(readonly url: string) {}
}

/**
 * Emitted when a Flow WebSocket connection closes.
 * @category Realtime
 */
export class WebSocketDisconnected {
  constructor(readonly url: string) {}
}

/**
 * Emitted after a Flow component action round-trips over the WebSocket. Carries
 * the same rich context an HTTP request does: `ip`, and the request-scoped `ctx`
 * (an HttpContext with `user` set by re-run middleware, and the SQL queries that
 * ran during the action correlated to it).
 *
 * @category Realtime
 */
export class FlowActionHandled {
  constructor(
    readonly component: string,
    readonly action: string,
    readonly durationMs: number,
    readonly ok: boolean,
    readonly ip: string | null,
    readonly ctx: object | undefined,
  ) {}
}
