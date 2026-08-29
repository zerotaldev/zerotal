// ── Socket: first-party realtime client for @zerotal/broadcasting ────────────
//
// A small, dependency-free WebSocket client that speaks the *native* Zerotal
// broadcasting protocol (the `ws` / `redis` drivers) and exposes a familiar
// realtime-client API — the same `channel()/private()/join()/leave()` +
// `listen()/here()/joining()/leaving()` surface — so it works with `@zerotal/flow`'s
// `@on('socket:…')` listeners with zero external dependencies.
//
//   import { Socket } from "@zerotal/client";
//
//   const socket = new Socket();                         // ws(s)://<host>/app/ws
//   socket.channel("posts").listen("PostPublished", (e) => render(e));
//   socket.private(`orders.${id}`).listen("OrderUpdated", (e) => update(e.order));
//
//   const room = socket.presence(`chat.${id}`)
//     .here((members) => setOnline(members))
//     .joining((m) => addOnline(m))
//     .leaving((m) => removeOnline(m))
//     .listen("Message", (e) => append(e));
//
// Private/presence channels are authorized with a per-subscription HMAC signature, like
// Pusher: before subscribing, the client POSTs `{ socket_id, channel_name }` to
// `authEndpoint` (default `/broadcasting/auth`), and the server signs it against the app's
// APP_KEY after running the `routes/channels.ts` rules. The signature is socket-bound, so it
// is re-fetched on every (re)connection. Set `authEndpoint: false` to skip the fetch and rely
// on connection-level authorization (the server's `authorizeWith` callback) instead.

/** A single member of a presence channel (matches the server's `PresenceMember`). */
export interface PresenceMember {
  id: string | number;
  info: Record<string, unknown>;
}

/** Connection-state events you can observe via `socket.on(state, cb)`. */
export type SocketState = "connecting" | "connected" | "disconnected" | "reconnecting" | "error";

/** Minimal WebSocket surface — lets tests inject a fake. Matches the browser `WebSocket`. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface SocketOptions {
  /**
   * Full WebSocket URL. When omitted it's derived from the page location (browser) as
   * `ws(s)://<host>:<port><path>`. Required in non-browser environments.
   */
  url?: string | undefined;
  /** WebSocket upgrade path. Defaults to `/app/ws` (matches the broadcasting config default). */
  path?: string | undefined;
  /** Host override (defaults to `location.hostname`). */
  host?: string | undefined;
  /** Port override (defaults to `location.port`). */
  port?: string | number | undefined;
  /** Force a scheme. Defaults to `wss` on https pages, `ws` otherwise. */
  scheme?: "ws" | "wss" | undefined;
  /**
   * Authentication for the connection and for private/presence channels:
   *  - `params`  — query params appended to the WS URL (browsers can't set WS headers), read
   *                by the server on upgrade.
   *  - `headers` — sent on the `POST /broadcasting/auth` request (e.g. a CSRF token).
   */
  auth?: { params?: Record<string, string>; headers?: Record<string, string> } | undefined;
  /**
   * Endpoint that signs a private/presence subscription (Pusher-style). Defaults to
   * `/broadcasting/auth`. Set to `false` to skip the signature fetch and rely on
   * connection-level authorization instead.
   */
  authEndpoint?: string | false | undefined;
  /** Inject a `fetch` implementation for the auth request (tests / non-DOM runtimes). */
  fetch?: typeof fetch | undefined;
  /** Connect immediately on construction. Default: true. */
  autoConnect?: boolean | undefined;
  /** Reconnect automatically after an unexpected close. Default: true. */
  reconnect?: boolean | undefined;
  /** Initial reconnect delay in ms (doubles each attempt up to `maxReconnectDelay`). Default: 1000. */
  reconnectDelay?: number | undefined;
  /** Cap on the reconnect backoff in ms. Default: 30000. */
  maxReconnectDelay?: number | undefined;
  /** Heartbeat ping interval in ms (0 disables). Default: 30000. */
  pingInterval?: number | undefined;
  /** Inject a WebSocket constructor (tests / non-DOM runtimes). Defaults to the global. */
  WebSocket?: (new (url: string) => SocketLike) | undefined;
}

type Listener = (payload: unknown) => void;

// Server → client framing (native BroadcastManager protocol).
interface ServerFrame {
  event: string;
  channel?: string;
  data?: unknown;
  message?: string;
}

const WS_OPEN = 1;

/** A subscribed channel. Bind broadcast events with {@link Channel.listen}. */
export class Channel {
  /** @internal event name → set of listeners */
  protected _listeners = new Map<string, Set<Listener>>();
  /** @internal fired on `subscription_error` */
  protected _errorCbs = new Set<Listener>();
  /** @internal fired on `subscription_succeeded` */
  protected _subscribedCbs = new Set<Listener>();

  constructor(
    /** The wire channel name (already prefixed, e.g. `private-orders.42`). */
    readonly name: string,
    protected readonly _socket: Socket,
  ) {}

  /** Bind a callback to a broadcast event on this channel. Chainable. */
  listen(event: string, cb: Listener): this {
    let set = this._listeners.get(event);
    if (!set) this._listeners.set(event, (set = new Set()));
    set.add(cb);
    return this;
  }

  /** Remove a specific listener, or all listeners for an event when `cb` is omitted. Chainable. */
  stopListening(event: string, cb?: Listener): this {
    if (cb) this._listeners.get(event)?.delete(cb);
    else this._listeners.delete(event);
    return this;
  }

  /** Called when the server rejects the subscription (e.g. unauthorized). Chainable. */
  error(cb: Listener): this {
    this._errorCbs.add(cb);
    return this;
  }

  /** Called once the subscription is confirmed. Chainable. */
  subscribed(cb: Listener): this {
    this._subscribedCbs.add(cb);
    return this;
  }

  /** Leave (unsubscribe from) this channel. */
  unsubscribe(): void {
    this._socket.leaveChannel(this.name);
  }

  /** @internal Dispatch an incoming frame to the bound listeners. */
  _dispatch(frame: ServerFrame): void {
    switch (frame.event) {
      case "subscription_succeeded":
        this._emit(this._subscribedCbs, frame.data);
        break;
      case "subscription_error":
        this._emit(this._errorCbs, frame.message ?? frame.data ?? "Unauthorized");
        break;
      default: {
        const set = this._listeners.get(frame.event);
        if (set) this._emit(set, frame.data);
      }
    }
  }

  protected _emit(cbs: Set<Listener>, payload: unknown): void {
    for (const cb of cbs) {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[Socket] listener for "${this.name}" threw:`, err);
      }
    }
  }
}

/** A presence channel — tracks who's currently subscribed. */
export class PresenceChannel extends Channel {
  private _hereCbs = new Set<Listener>();
  private _joiningCbs = new Set<Listener>();
  private _leavingCbs = new Set<Listener>();

  /** Called once with the full member list when you join. Chainable. */
  here(cb: (members: PresenceMember[]) => void): this {
    this._hereCbs.add(cb as Listener);
    return this;
  }

  /** Called when another member joins. Chainable. */
  joining(cb: (member: PresenceMember) => void): this {
    this._joiningCbs.add(cb as Listener);
    return this;
  }

  /** Called when a member leaves. Chainable. */
  leaving(cb: (member: PresenceMember) => void): this {
    this._leavingCbs.add(cb as Listener);
    return this;
  }

  override _dispatch(frame: ServerFrame): void {
    const data = frame.data as { members?: PresenceMember[]; member?: PresenceMember } | undefined;
    switch (frame.event) {
      case "subscription_succeeded":
        this._emit(this._subscribedCbs, frame.data);
        this._emit(this._hereCbs, data?.members ?? []);
        break;
      case "presence:member_added":
        if (data?.member) this._emit(this._joiningCbs, data.member);
        break;
      case "presence:member_removed":
        if (data?.member) this._emit(this._leavingCbs, data.member);
        break;
      default:
        super._dispatch(frame);
    }
  }
}

/** The options {@link Socket}'s constructor always fills in. */
type GuaranteedOption =
  | "path"
  | "autoConnect"
  | "reconnect"
  | "reconnectDelay"
  | "maxReconnectDelay"
  | "pingInterval"
  | "authEndpoint";

/**
 * Realtime client for Zerotal broadcasting (native `ws` / `redis` drivers). Exposes a
 * familiar realtime-client API over the native protocol — see the module header for usage.
 */
export class Socket {
  private _ws: SocketLike | null = null;
  private _channels = new Map<string, Channel>();
  private _socketId: string | null = null;
  private _state: SocketState = "disconnected";
  private _stateCbs = new Map<SocketState, Set<(detail?: unknown) => void>>();
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _closedByUser = false;
  /**
   * The seven fields the constructor guarantees, plus whatever else was passed.
   *
   * `Omit` rather than `& SocketOptions`: intersecting with the whole shape puts the
   * optional declaration of each guaranteed field back alongside the required one, so
   * `pingInterval` read as possibly `undefined` in the very code that had just given
   * it a default.
   */
  private readonly _opts: {
    [K in GuaranteedOption]-?: Exclude<SocketOptions[K], undefined>;
  } & Omit<SocketOptions, GuaranteedOption>;

  constructor(options: SocketOptions = {}) {
    // The caller's options go FIRST, then the defaults fill the gaps.
    //
    // This used to be the other way round — defaults, then `...options` — but object spread
    // copies own properties even when their value is `undefined`. So
    // `new Socket({ url, pingInterval: cfg.pingInterval })` with an unset config wrote
    // `undefined` straight back over the 30000 default, and `setInterval(fn, undefined)`
    // coerces the delay to 0: measured at ~830 pings/second per client. The `pingInterval <= 0`
    // guard did not catch it because `undefined <= 0` is false. The same spread silently
    // disabled `reconnect`. Passing options first keeps every explicitly-supplied field
    // (`url`, `host`, `port`, `scheme`, …) while letting `??` reject undefined.
    this._opts = {
      ...options,
      path: options.path ?? "/app/ws",
      autoConnect: options.autoConnect ?? true,
      reconnect: options.reconnect ?? true,
      reconnectDelay: options.reconnectDelay ?? 1000,
      maxReconnectDelay: options.maxReconnectDelay ?? 30000,
      pingInterval: options.pingInterval ?? 30000,
      authEndpoint: options.authEndpoint ?? "/broadcasting/auth",
    };
    if (this._opts.autoConnect) this.connect();
  }

  // ── Connection ────────────────────────────────────────────────────────────

  /** The socket id assigned by the server — pass it as the `X-Socket-ID` header so server
   *  `toOthers()` broadcasts skip this client. `null` until connected. */
  socketId(): string | null {
    return this._socketId;
  }

  /** Current connection state. */
  get state(): SocketState {
    return this._state;
  }

  /** Open the connection (no-op if already open/connecting). */
  connect(): void {
    if (this._ws && (this._ws.readyState === WS_OPEN || this._ws.readyState === 0)) return;
    this._closedByUser = false;
    this._setState(this._reconnectAttempts > 0 ? "reconnecting" : "connecting");

    const Ctor = this._opts.WebSocket ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!Ctor) throw new Error("[Socket] No WebSocket implementation available.");

    const ws = new (Ctor as unknown as new (url: string) => SocketLike)(this._buildUrl());
    this._ws = ws;
    ws.onopen = () => this._onOpen();
    ws.onmessage = (ev) => this._onMessage(ev.data);
    ws.onclose = (ev) => this._onClose(ev);
    ws.onerror = (ev) => this._setState("error", ev);
  }

  /** Close the connection and stop reconnecting. */
  disconnect(): void {
    this._closedByUser = true;
    this._clearTimers();
    this._ws?.close();
    this._ws = null;
    this._setState("disconnected");
  }

  /** Register a connection-state callback. Returns an unsubscribe function. */
  on(state: SocketState, cb: (detail?: unknown) => void): () => void {
    let set = this._stateCbs.get(state);
    if (!set) this._stateCbs.set(state, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  // ── Channels ──────────────────────────────────────────────────────────────

  /** Subscribe to a public channel. */
  channel(name: string): Channel {
    return this._subscribe(name, () => new Channel(name, this));
  }

  /** Subscribe to a private channel (the `private-` prefix is added for you). */
  private(name: string): Channel {
    const wire = `private-${name}`;
    return this._subscribe(wire, () => new Channel(wire, this));
  }

  /** Subscribe to a presence channel (the `presence-` prefix is added for you). */
  presence(name: string): PresenceChannel {
    const wire = `presence-${name}`;
    return this._subscribe(wire, () => new PresenceChannel(wire, this)) as PresenceChannel;
  }

  /** Alias for {@link presence} (`window.Socket.join(...)`). */
  join(name: string): PresenceChannel {
    return this.presence(name);
  }

  /**
   * Leave a channel by its base name — unsubscribes the public, `private-`, and `presence-`
   * variants, which is what `leave()` means here.
   */
  leave(name: string): void {
    this.leaveChannel(name);
    this.leaveChannel(`private-${name}`);
    this.leaveChannel(`presence-${name}`);
  }

  /** Leave one exact (already-prefixed) channel. */
  leaveChannel(wireName: string): void {
    if (!this._channels.delete(wireName)) return;
    this._sendRaw({ event: "unsubscribe", channel: wireName });
  }

  /** All currently-subscribed channels (by wire name). */
  channels(): Channel[] {
    return [...this._channels.values()];
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private _subscribe(wireName: string, make: () => Channel): Channel {
    const existing = this._channels.get(wireName);
    if (existing) return existing;
    const ch = make();
    this._channels.set(wireName, ch);
    if (this._state === "connected") this._subscribeChannel(wireName);
    return ch;
  }

  /**
   * Send a `subscribe` for one channel. Public channels subscribe directly; private/presence
   * channels first fetch a Pusher-style signature from `authEndpoint` (covering the current
   * socket id) and include it. Re-runs per (re)connection, since the signature is socket-bound.
   */
  private _subscribeChannel(wireName: string): void {
    if (this._state !== "connected") return;
    const needsAuth = wireName.startsWith("private-") || wireName.startsWith("presence-");

    if (!needsAuth || this._opts.authEndpoint === false) {
      this._sendRaw({ event: "subscribe", channel: wireName });
      return;
    }

    void this._authorize(wireName).then((res) => {
      // The channel may have been left, or the connection dropped, while auth was in flight.
      if (!this._channels.has(wireName) || this._state !== "connected") return;
      if (!res) {
        this._channels.get(wireName)?._dispatch({
          event: "subscription_error",
          channel: wireName,
          message: "Authorization failed",
        });
        return;
      }
      this._sendRaw({
        event: "subscribe",
        channel: wireName,
        auth: res.auth,
        ...(res.channel_data !== undefined ? { channelData: res.channel_data } : {}),
      });
    });
  }

  /** Fetch a per-subscription signature from the auth endpoint for `channel`. */
  private async _authorize(
    channel: string,
  ): Promise<{ auth: string; channel_data?: string } | null> {
    const endpoint = this._opts.authEndpoint;
    if (endpoint === false || !this._socketId) return null;
    const doFetch = this._opts.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!doFetch) return null;
    try {
      const res = await doFetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(this._opts.auth?.headers ?? {}) },
        body: JSON.stringify({ socket_id: this._socketId, channel_name: channel }),
      });
      if (!res.ok) return null;
      return (await res.json()) as { auth: string; channel_data?: string };
    } catch {
      return null;
    }
  }

  private _onOpen(): void {
    this._reconnectAttempts = 0;
    // Don't flip to "connected" until the server's `connected` frame gives us a socketId.
    this._startPing();
  }

  private _onMessage(raw: unknown): void {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(typeof raw === "string" ? raw : String(raw)) as ServerFrame;
    } catch {
      return;
    }

    switch (frame.event) {
      case "connected": {
        this._socketId = (frame.data as { socketId?: string } | undefined)?.socketId ?? null;
        this._setState("connected");
        // (Re)subscribe every channel now the connection is live (private/presence re-auth
        // against the new socket id).
        for (const name of this._channels.keys()) this._subscribeChannel(name);
        return;
      }
      case "pong":
        return;
      case "error":
        this._setState("error", frame.message);
        return;
    }

    // Channel-scoped frame → dispatch to that channel.
    if (frame.channel) {
      this._channels.get(frame.channel)?._dispatch(frame);
    }
  }

  private _onClose(ev: { code?: number; reason?: string }): void {
    this._clearTimers();
    this._ws = null;
    this._socketId = null;
    if (this._closedByUser) {
      this._setState("disconnected");
      return;
    }
    this._setState("disconnected", ev);
    if (this._opts.reconnect) this._scheduleReconnect();
  }

  private _scheduleReconnect(): void {
    const delay = Math.min(
      this._opts.reconnectDelay * 2 ** this._reconnectAttempts,
      this._opts.maxReconnectDelay,
    );
    this._reconnectAttempts++;
    this._reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private _startPing(): void {
    if (this._opts.pingInterval <= 0) return;
    this._pingTimer = setInterval(() => this._sendRaw({ event: "ping" }), this._opts.pingInterval);
  }

  private _clearTimers(): void {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._reconnectTimer = null;
    this._pingTimer = null;
  }

  private _sendRaw(msg: Record<string, unknown>): void {
    if (this._ws && this._ws.readyState === WS_OPEN) this._ws.send(JSON.stringify(msg));
  }

  private _setState(state: SocketState, detail?: unknown): void {
    this._state = state;
    const set = this._stateCbs.get(state);
    if (set) for (const cb of set) cb(detail);
  }

  private _buildUrl(): string {
    if (this._opts.url) return this._withAuth(this._opts.url);

    const loc = (globalThis as { location?: { protocol: string; hostname: string; port: string } })
      .location;
    const scheme = this._opts.scheme ?? (loc?.protocol === "https:" ? "wss" : "ws");
    const host = this._opts.host ?? loc?.hostname;
    if (!host) {
      throw new Error("[Socket] No URL and no `location` to derive one — pass `url` or `host`.");
    }
    const port = this._opts.port ?? loc?.port ?? "";
    const authority = port ? `${host}:${port}` : host;
    return this._withAuth(`${scheme}://${authority}${this._opts.path}`);
  }

  private _withAuth(url: string): string {
    const params = this._opts.auth?.params;
    if (!params || Object.keys(params).length === 0) return url;
    const qs = new URLSearchParams(params).toString();
    return url + (url.includes("?") ? "&" : "?") + qs;
  }
}
