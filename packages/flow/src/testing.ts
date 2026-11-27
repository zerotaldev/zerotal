/**
 * `@zerotal/flow/testing` — in-process test helpers for Flow components.
 *
 * {@link FlowTest} drives a page through the same code the running app uses, without a
 * server or a browser. {@link FlowTest.mount} sends the initial GET through the page's
 * route handler, inside the app's middleware and a request scope of its own. Every action
 * after that is a call frame handed to the action handler, exactly as the HTTP fallback
 * hands it one: the page is rebuilt from the signed snapshot, the route's middleware runs
 * again, the method has to be `@expose`d, and the frames the handler sends back are what
 * the assertions read.
 *
 * So a test sees what a visitor sees. State that is neither `@expose`d nor `@locked` is
 * gone on the next action, a method the browser may not call is refused with the server's
 * own message, and a render that throws fails the test with its stack.
 *
 * @example
 * ```ts
 * import { FlowTest } from '@zerotal/flow/testing';
 *
 * const t = await FlowTest.mount(LoginPage);
 * await t.update('email', 'test@example.com');
 * await t.update('password', 'secret');
 * await t.call('login');
 * t.assertRedirectedTo('/dashboard');
 * ```
 *
 * @example
 * ```ts
 * const t = await FlowTest.actingAs(ada).mount(EditPostPage, {}, { url: '/posts/1?tab=seo' });
 * await t.call('save');
 * t.assertHasErrors('title');
 * t.assertSee('The title field is required.');
 * ```
 *
 * @packageDocumentation
 */

import {
  Container,
  HttpContext,
  Pipeline,
  RequestContext,
  Router,
  tryCurrentApp,
  type MiddlewareClass,
  type NextFn,
} from "@zerotal/core";
import type { Component, FlowEffects } from "./Component.ts";
import {
  dehydrate,
  applySnapshotData,
  applySnapshotDelta,
  type SnapshotDelta,
} from "./dehydrate.ts";
import { _makeFlowHandler } from "./router.ts";
import { _renderFlowPage } from "./jsx-runtime.ts";
import { _getPageEntries, getPage, registerPage, type PageClassWithMeta } from "./registry.ts";
import {
  FlowProvider,
  _handleFlowMessage,
  _sessionRelayResponse,
} from "./provider/FlowProvider.ts";
import {
  getComputedKeys,
  getExposedProps,
  getLockedProps,
  getModelableProps,
  getReactiveProps,
  getTransientKeys,
} from "./decorators.ts";
import { _carryMonotonic } from "./monotonic.ts";
import type { Snapshot } from "./types.ts";

type PageClass<T extends Component> = new () => T;

/**
 * The user a {@link FlowTest} acts as: anything with an `id`, a model included.
 *
 * It is put on the request's context before any middleware runs, which is where the
 * session middleware leaves the signed-in user, so `Auth.user()`, `ctx.user` and the
 * snapshot's owner all see it.
 */
export interface FlowTestUser {
  id: string | number;
}

/** Where and how {@link FlowTest.mount} requests the page. */
export interface FlowTestMountOptions {
  /**
   * The URL the page is requested at, query string included: `"/posts/1?tab=seo"`.
   * `@url` properties are read from its query string, as on a real visit. Defaults to the
   * page's route, or `/` for a page with none.
   */
  url?: string | undefined;
  /**
   * Route parameters, as the router puts them on `ctx.params`: strings, or the models a
   * route binding resolved. A field named after one, or marked `@param`, is filled from it.
   * For a page routed with `Router.flow()` or a file route, the URL's segments are matched
   * against the route and its bindings resolved, and these are laid over the top.
   */
  params?: Record<string, unknown> | undefined;
  /** The signed-in user, as {@link FlowTest.actingAs} sets it. `null` is a guest. */
  user?: FlowTestUser | null | undefined;
  /** Headers sent with the page request and with every action after it. */
  headers?: Record<string, string> | undefined;
  /**
   * Values the session holds before the page is requested — a password confirmed a minute
   * ago, a sign-in waiting for its second factor. Written by the app's own session driver
   * into the cookie the page is requested with, so it needs the app booted with sessions.
   */
  session?: Record<string, unknown> | undefined;
}

/** The part of the app's session driver that writes a session into a cookie. */
interface SessionDriverLike {
  saveSession(id: string, data: Record<string, unknown>, response: Response): Promise<void>;
}

/** A frame the action handler sent back, as the client parses it. */
type Frame =
  | ({
      type: "patch";
      html?: string;
      errors?: Record<string, string[]>;
      scripts?: string[];
      title?: string;
      partial?: boolean;
    } & SnapshotDelta)
  | ({ type: "flash"; component?: string } & FlowEffects["flashes"][number])
  | { type: "event"; name: string; data?: Record<string, unknown>; to?: string; self?: string }
  | { type: "download"; filename: string; content: string; mime: string }
  | { type: "redirect"; url: string; flashes?: FlowEffects["flashes"]; sessionToken?: string }
  | { type: "session"; token: string }
  | { type: "error"; message?: string; component?: string }
  | { type: "stream" };

/** The same frames, as {@link FlowTest.frames} hands them out. */
type RawFrame = { type: string } & Record<string, unknown>;

/** The origin the page and its actions are requested at. */
const ORIGIN = "http://localhost";

/** Gives each harness an address of its own, so one test's refused calls never count against another's. */
let _harnesses = 0;

/**
 * The middleware classes put on FlowProvider's persistent list while an action is in flight,
 * each with how many actions are using it.
 */
const _heldIdentities = new Map<MiddlewareClass, number>();

/**
 * A fluent test harness around a single mounted Flow page. Obtain one with
 * {@link FlowTest.mount}, drive it with `call`/`update`/`set`, then chain assertions
 * against the rendered HTML, redirects, validation errors, flashes, and dispatched events.
 *
 * Every action goes through the real action handler: the page is rebuilt from its signed
 * snapshot, middleware runs, and only what the browser could do is allowed.
 *
 * @typeParam T - The Component subclass under test.
 */
export class FlowTest<T extends Component> {
  private readonly _PageClass: PageClass<T>;
  private readonly _name: string;
  private readonly _path: string;
  private readonly _headers: Record<string, string>;
  private readonly _ip: string;
  private readonly _cookies = new Map<string, string>();
  private _user: FlowTestUser | null;

  private _page: T;
  private _html: string = "";
  private _document: string = "";
  private _effects: FlowEffects | null = null;
  private _errors: Record<string, string[]> = {};
  private _snapshot: Snapshot | null = null;
  private _frames: RawFrame[] = [];
  /** Set by {@link tolerateErrors}: capture action errors instead of rethrowing them. */
  private _tolerateErrors = false;
  /** The last error an action threw or the server answered with, when {@link tolerateErrors} is on. */
  private _lastError: Error | null = null;
  /** The container used when no application has been booted. */
  private _ownContainer: Container | null = null;
  /** The mount rendered a static page: no snapshot, and `set()`/`render()` use its instance. */
  private _static = false;
  /** The URL the page was mounted at, which a static page renders again at. */
  private _url = "/";

  private constructor(
    PageClass: PageClass<T>,
    path: string,
    user: FlowTestUser | null,
    headers: Record<string, string>,
  ) {
    this._PageClass = PageClass;
    this._name = PageClass.name;
    this._path = path;
    this._user = user;
    this._headers = headers;
    _harnesses++;
    this._ip = `127.0.${(_harnesses >> 8) & 255}.${_harnesses & 255}`;
    this._page = new PageClass();
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  /**
   * Mount a page: send the initial GET through its route handler, inside the app's
   * middleware, and return the harness for chaining.
   *
   * The handler runs the page's initial-request lifecycle (`onBoot()`, then `onMount()`),
   * seeds `@url`, `@session` and `@param` fields as it does for a visitor, renders the page
   * in its layout, and signs the snapshot every later action is rebuilt from.
   *
   * @param PageClass - The Component subclass to mount.
   * @param props - Values assigned to the new instance before anything else runs. Only those
   *   on `@expose` or `@locked` fields outlive the first request.
   * @param options - The URL, route parameters, user and headers to request the page with.
   * @returns A resolved {@link FlowTest} wrapping the mounted page.
   * @throws Whatever the page's middleware, `onBoot()`, `onMount()` or `render()` threw.
   * @category Lifecycle
   *
   * @example
   * ```ts
   * const t = await FlowTest.mount(DashboardPage);
   * const search = await FlowTest.mount(PostsPage, {}, { url: "/posts?search=bun" });
   * ```
   */
  static async mount<T extends Component>(
    PageClass: PageClass<T>,
    props: Partial<T> = {},
    options: FlowTestMountOptions = {},
  ): Promise<FlowTest<T>> {
    const path = _routeOf(PageClass, options.url);
    const t = new FlowTest<T>(PageClass, path, options.user ?? null, { ...options.headers });
    await t._mount(props, options);
    return t;
  }

  /**
   * Mount pages as a signed-in user — the first step of a chain.
   *
   * @param user - The user every request of the mounted page carries, or `null` for a guest.
   * @returns An object whose `mount()` takes {@link FlowTest.mount}'s arguments.
   * @category Lifecycle
   *
   * @example
   * ```ts
   * const t = await FlowTest.actingAs(ada).mount(SettingsPage);
   * ```
   */
  static actingAs(user: FlowTestUser | null): {
    mount<T extends Component>(
      PageClass: PageClass<T>,
      props?: Partial<T>,
      options?: FlowTestMountOptions,
    ): Promise<FlowTest<T>>;
  } {
    return {
      mount: (PageClass, props = {}, options = {}) =>
        FlowTest.mount(PageClass, props, { ...options, user: options.user ?? user }),
    };
  }

  /**
   * Act as a different user from the next action on.
   *
   * The snapshot belongs to whoever the page was rendered for, so the next action is refused
   * the way a page left open across a sign-out is: "Your session changed — reload the page."
   * @category Actions
   */
  actingAs(user: FlowTestUser | null): this {
    this._user = user;
    return this;
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Put a value into the page's state and render it — setup, not something a browser can do.
   *
   * The page is rebuilt from its snapshot, the value is assigned, and the result is signed as
   * the server would sign it, then rendered through the action handler (`onBoot()`,
   * `onHydrate()`, `render()`). No update hooks fire; use {@link update} for a value the
   * visitor typed.
   *
   * @throws When the field is not part of the snapshot. A value on a field that is neither
   *   `@expose`d nor `@locked` is gone before the next action, as it is in production.
   * @category Actions
   */
  async set(prop: keyof T, value: unknown): Promise<this> {
    await this.seed(prop, value);
    return this.render();
  }

  /**
   * Put a value into the page's state without rendering — the batching form of {@link set}.
   * Nothing reads the new value until the next `set`/`update`/`call`/`render`.
   * @category Actions
   *
   * @example
   * ```ts
   * await t.seed('step', 3);
   * await t.seed('mode', 'advanced');
   * await t.render();          // one render for both
   * ```
   */
  async seed(prop: keyof T, value: unknown): Promise<this> {
    if (this._static) {
      // No snapshot and no next request: the value stands in for what onMount() left there.
      Reflect.set(this._page, String(prop), value);
      return this;
    }
    const snapshot = this._requireSnapshot(`set("${String(prop)}")`);
    const key = String(prop);
    this._snapshot = await this._inRequest(snapshot.memo.sub, async () => {
      const page = await this._rebuild(snapshot);
      if (!_serializedKeys(page).has(key)) {
        throw new Error(
          `[FlowTest] "${key}" on ${this._name} is not part of its snapshot, so a value set ` +
            `on it is gone by the next action. Mark it @expose() (the browser may change it) ` +
            `or @locked() (the server owns it) if it is state the page keeps.`,
        );
      }
      Reflect.set(page, key, value);
      page._childIds = [...(snapshot.memo.children ?? [])];
      // The id the snapshot was signed with (the dispatcher sets it from the memo too), and a
      // monotonic page's sequence as it was: setup is not an action.
      page._flowId = snapshot.memo.id;
      _carryMonotonic(snapshot, page);
      return dehydrate(page, snapshot.memo);
    });
    this._page = await this._rebuildInRequest(this._snapshot);
    return this;
  }

  /**
   * Render the page again from its snapshot, as fast refresh does: `onBoot()`, `onHydrate()`,
   * `render()`, with no action and no `onMount()`. Pairs with {@link seed}.
   *
   * A static page (`static interactive = false`) has no snapshot and no later request, so it
   * is the instance the mount built that renders again, with whatever `set()` put on it.
   * @category Actions
   */
  async render(): Promise<this> {
    if (this._static) {
      const page = this._page;
      this._html = await this._inRequest(
        this._user,
        () => _renderFlowPage(page, () => page.render()),
        this._url,
      );
      return this;
    }
    await this._send("$rerender", [], false);
    return this;
  }

  /**
   * Change a property as the browser does when a visitor types into a bound input: the
   * write goes through the `@expose` allowlist and fires `onUpdating()` / `onUpdated()` (and
   * their per-property variants), then the page renders.
   *
   * @throws When the browser could not change the field: it is not `@expose`d, or it is
   *   `@locked`. The server ignores such a write without a word, so the test says so instead.
   * @category Actions
   */
  async update(prop: keyof T, value: unknown): Promise<this> {
    const key = String(prop);
    const exposed = getExposedProps(this._page);
    const parentOwned =
      getReactiveProps(this._page).has(key) && !getModelableProps(this._page).has(key);
    if (!exposed.has(key) || getLockedProps(this._page).has(key) || parentOwned) {
      const why = !exposed.has(key)
        ? "not @expose()d"
        : parentOwned
          ? "@reactive(), so its value comes from the parent"
          : "@locked()";
      throw new Error(
        `[FlowTest] update("${key}"): the server ignores a browser write to "${key}" on ` +
          `${this._name}, because it is ${why}. Use set() to put a value there as setup.`,
      );
    }
    await this._send("$set", [key, value]);
    return this;
  }

  /**
   * Opt out of the rethrow in {@link call}: a throwing action is captured on the
   * harness instead of failing the test, so the error path itself can be asserted.
   *
   * Only for tests *about* error handling. Leaving it off is what makes a broken
   * action fail its test rather than look like a no-op.
   * @category Actions
   *
   * @example
   * ```ts
   * const t = (await FlowTest.mount(CheckoutPage)).tolerateErrors();
   * await t.call('submit');
   * t.assertErrored(/payment gateway/);
   * ```
   */
  tolerateErrors(): this {
    this._tolerateErrors = true;
    return this;
  }

  /** The last error an action threw or the server answered with, or null. @category Actions */
  lastError(): Error | null {
    return this._lastError;
  }

  /**
   * Assert the last action threw, optionally matching its message.
   * Requires {@link tolerateErrors} — without it a throwing action fails the test outright.
   * @category Assertions
   */
  assertErrored(match?: string | RegExp): this {
    if (!this._lastError) {
      throw new Error(
        `[FlowTest] Expected the last action on ${this._name} to throw, but it did not.`,
      );
    }
    if (match !== undefined) {
      const message = this._lastError.message;
      const ok = typeof match === "string" ? message.includes(match) : match.test(message);
      if (!ok) {
        throw new Error(
          `[FlowTest] Expected the error message to match ${String(match)}, but got: ${message}`,
        );
      }
    }
    return this;
  }

  /**
   * Call an action, as a click in the browser does: a call frame goes to the action handler,
   * which rebuilds the page from its snapshot, runs the route's middleware, `onBoot()` and
   * `onHydrate()`, the method, `onUpdate()`, then renders and signs a new snapshot.
   *
   * A `ValidationError` is an expected outcome: the errors are stored and the page
   * re-renders with the error bag populated, exactly as in production.
   *
   * Anything else fails the test, after the page has rendered the way a visitor would see
   * it: an action that threw (after `onError()` ran), a method that is not `@expose`d, a
   * render that threw, middleware that turned the request away. Call {@link tolerateErrors}
   * first when that path is what you are testing.
   *
   * @param method - Name of the method to invoke on the page.
   * @param args - Arguments forwarded to the method, sent as JSON as the browser sends them.
   * @throws The error the action or render threw, or the server's refusal, unless
   *   {@link tolerateErrors} is on.
   * @category Actions
   */
  async call(method: string, ...args: unknown[]): Promise<this> {
    await this._send(method, args);
    return this;
  }

  // ── The pipeline ───────────────────────────────────────────────────────────

  /** The initial GET, through the global and route middleware to the page's handler. */
  private async _mount(props: Partial<T>, options: FlowTestMountOptions): Promise<void> {
    if (options.session) await this._startSession(options.session);
    const PageClass = this._PageClass;
    // The handler builds the page with `new PageClass()`. This hands it the same class with the
    // props laid on the new instance, and keeps the instance for a page that has no snapshot.
    let live: T | null = null;
    const Seeded: PageClassWithMeta = new Proxy(PageClass, {
      construct(target, args) {
        const page = Reflect.construct(target, args) as T;
        Object.assign(page, props);
        live = page;
        return page;
      },
    });

    const url = new URL(
      options.url ?? (_isTestRoute(this._path) ? "/" : _concretePath(this._path)),
      ORIGIN,
    );
    this._url = `${url.pathname}${url.search}`;
    const route = Router.routes.get(`GET ${this._path}`);
    const params = { ..._matchRoute(this._path, url.pathname), ...options.params };
    const Handler = _makeFlowHandler(this._path, Seeded);

    const Bindings = class {
      async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
        const held = ctx.params as Record<string, unknown>;
        for (const [name, resolve] of route?.bindings ?? []) {
          const value = held[name];
          if (typeof value !== "string") continue;
          const model = await resolve(value, ctx);
          ctx._models.set(name, model);
          held[name] = model;
        }
        return next();
      }
    };
    const Page = class {
      async handle(ctx: HttpContext): Promise<Response | void> {
        await new Handler().handle(ctx);
        return ctx.response;
      }
    };

    const container = this._container();
    const response = await container.runScoped(async (scoped) => {
      const request = new Request(url, { headers: this._requestHeaders() });
      const ctx = new HttpContext(request, scoped);
      (ctx as { params: Record<string, unknown> }).params = params;
      ctx._server = this._ipProvider();
      return RequestContext.run(ctx, async () => {
        await Pipeline.send<HttpContext>(ctx)
          .through([
            this._identity(),
            ...this._globalMiddleware(),
            ...(route?.middleware ?? []),
            Bindings,
            Page,
          ])
          .via(container)
          .thenReturn();
        const answer = ctx.response ?? new Response(null, { status: 204 });
        for (const finalize of ctx._responseFinalizers) await finalize(answer);
        return answer;
      });
    });

    for (const cookie of response.headers.getSetCookie()) this._keepCookie(cookie);

    const location = response.headers.get("Location");
    if (response.status >= 300 && response.status < 400 && location) {
      this._effects = { ..._noEffects(), redirectUrl: location };
      if (live) this._page = live;
      return;
    }
    if (response.status !== 200) {
      throw new Error(
        `[FlowTest] GET ${url.pathname}${url.search} was answered with ${response.status} ` +
          `before ${this._name} rendered, by a middleware that turned the request away.`,
      );
    }

    this._document = await response.text();
    const snapshot = _pageState(this._document, this._name);
    this._html = _rootHtml(this._document, snapshot?.memo.id);
    if (live) this._errors = { ...(live as T)._errors };
    if (snapshot) {
      this._snapshot = snapshot;
      this._page = await this._rebuildInRequest(snapshot);
    } else if (live) {
      this._page = live;
      this._static = true;
    }
  }

  /**
   * Send one call frame through the action handler and take in what it sends back.
   *
   * @param method - The action, or a built-in (`$set`, `$rerender`).
   * @param args - The action's arguments.
   * @param isAction - Whether the frame's flashes, events and errors replace the last ones.
   *   `set()` and `render()` are setup, so they leave what the last action did in place.
   */
  private async _send(method: string, args: unknown[], isAction = true): Promise<void> {
    const label = method.startsWith("$") ? method : `call("${method}")`;
    const snapshot = this._requireSnapshot(label);
    const frames: Frame[] = [];
    const raw: RawFrame[] = [];
    const reported: unknown[] = [];
    const app = tryCurrentApp();

    const socket = {
      data: {
        remoteIp: this._ip,
        origin: ORIGIN,
        headers: new Headers(this._requestHeaders()),
      },
      send(message: string): void {
        // JSON, as the browser receives it: the handler's frames and nothing else.
        const parsed: Frame & RawFrame = JSON.parse(message);
        frames.push(parsed);
        raw.push(parsed);
      },
    };

    const frame = {
      type: "call",
      component: snapshot.memo.id,
      method,
      args,
      updates: {},
      snapshot,
    };

    const identity = this._identity();
    _holdIdentity(identity);
    try {
      await _handleFlowMessage(socket, JSON.stringify(frame), {
        container: this._container(),
        globalMiddleware: () => [identity, ...this._globalMiddleware()],
        report: async (error, ctx) => {
          reported.push(error);
          if (app) await app._reportError(error, ctx);
        },
      });
    } finally {
      _releaseIdentity(identity);
    }

    this._frames = raw;
    const thrown = await this._take(frames, snapshot, reported, label, isAction);
    this._lastError = thrown;
    if (thrown && !this._tolerateErrors) throw thrown;
  }

  /**
   * Fold the frames one action produced into the harness's state.
   *
   * @returns The error the test should see, or `null` when the action went through.
   */
  private async _take(
    frames: Frame[],
    sent: Snapshot,
    reported: unknown[],
    label: string,
    isAction: boolean,
  ): Promise<Error | null> {
    const effects = _noEffects();
    let snapshot: Snapshot | null = null;
    let patched = false;
    let refusal: string | null = null;

    for (const frame of frames) {
      switch (frame.type) {
        case "patch": {
          patched = true;
          snapshot = applySnapshotDelta(snapshot ?? sent, frame);
          if (frame.html !== undefined) {
            this._html = _unwrapRoot(frame.html, sent.memo.id, sent.memo.name);
          }
          if (frame.partial !== true) {
            effects.errors = frame.errors ?? {};
            effects.scripts = frame.scripts ?? [];
            effects.title = frame.title ?? null;
          }
          break;
        }
        case "flash": {
          // `component` is the handler's: which component raised it, for the toast's buttons.
          const { type: _type, component: _component, ...flash } = frame;
          effects.flashes.push(flash);
          break;
        }
        case "event": {
          effects.events.push({
            name: frame.name,
            data: frame.data ?? {},
            ...(frame.to !== undefined ? { to: frame.to } : {}),
            ...(frame.self !== undefined ? { self: true } : {}),
          });
          break;
        }
        case "download": {
          const { filename, content, mime } = frame;
          effects.downloads.push({ filename, content, mime });
          break;
        }
        case "redirect": {
          effects.redirectUrl = frame.url;
          if (frame.flashes) effects.flashes.push(...frame.flashes);
          if (frame.sessionToken !== undefined) this._relay(frame.sessionToken);
          break;
        }
        case "session": {
          this._relay(frame.token);
          break;
        }
        case "error": {
          // The dev worker sends the action's stack this way before its patch; anything else
          // is the server turning the frame away.
          refusal ??= frame.message ?? "error";
          break;
        }
        default:
          break;
      }
    }

    if (snapshot) {
      this._snapshot = snapshot;
      this._page = await this._rebuildInRequest(snapshot);
    }
    if (isAction || effects.redirectUrl) {
      this._effects = effects;
      if (patched) this._errors = effects.errors;
    }

    const first = reported[0];
    if (first !== undefined) return first instanceof Error ? first : new Error(String(first));
    if (refusal !== null && !patched) {
      return new Error(`[FlowTest] The server refused ${label} on ${this._name}: ${refusal}`);
    }
    return null;
  }

  /** The snapshot the next frame is sent with, or a clear error when there is none to send. */
  private _requireSnapshot(what: string): Snapshot {
    if (this._snapshot) return this._snapshot;
    const why = this._effects?.redirectUrl
      ? `the mount redirected to ${this._effects.redirectUrl}`
      : `${this._name} is static (\`static interactive = false\`) and has no snapshot`;
    throw new Error(`[FlowTest] Cannot ${what} on ${this._name}: ${why}.`);
  }

  /** A fresh instance with the snapshot's state restored — what the next action starts from. */
  private async _rebuild(snapshot: Snapshot): Promise<T> {
    const page = new this._PageClass();
    await applySnapshotData(page, snapshot);
    return page;
  }

  /** {@link _rebuild} inside a request scope, for synthesizers that load from the container. */
  private _rebuildInRequest(snapshot: Snapshot): Promise<T> {
    return this._inRequest(snapshot.memo.sub, () => this._rebuild(snapshot));
  }

  /**
   * Run `fn` inside a request scope of the app's container, at `path`, signed in as `user`.
   * A snapshot's owner is a bare id, so a string stands for the user with that id.
   */
  private _inRequest<R>(
    user: FlowTestUser | string | null | undefined,
    fn: () => Promise<R>,
    path: string = this._path,
  ): Promise<R> {
    return this._container().runScoped(async (scoped) => {
      const ctx = new HttpContext(new Request(`${ORIGIN}${path}`), scoped);
      if (user !== undefined && user !== null) {
        (ctx as { user?: unknown }).user = typeof user === "string" ? { id: user } : user;
      }
      ctx._server = this._ipProvider();
      return RequestContext.run(ctx, fn);
    });
  }

  /** The booted application's container, or one of this harness's own when none is booted. */
  private _container(): Container {
    const app = tryCurrentApp();
    if (app) return app.container;
    return (this._ownContainer ??= new Container());
  }

  /** The booted application's global middleware, or none. */
  private _globalMiddleware(): MiddlewareClass[] {
    return tryCurrentApp()?.globalMiddleware ?? [];
  }

  /**
   * The step that signs the request in as {@link actingAs}'s user. It runs first, where the
   * session middleware would put a user, so the app's own middleware sees it as signed in.
   */
  private _identity(): MiddlewareClass {
    const signedIn = (): FlowTestUser | null => this._user;
    return class FlowTestIdentity {
      handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
        const user = signedIn();
        if (user) (ctx as { user?: unknown }).user = user;
        return next();
      }
    };
  }

  /** Answers `ctx.ip()` with this harness's address. */
  private _ipProvider(): NonNullable<HttpContext["_server"]> {
    const address = this._ip;
    return { requestIP: () => ({ address, family: "IPv4", port: 0 }) };
  }

  /** The headers every request carries: the test's own and the cookies kept so far. */
  private _requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { accept: "text/html", ...this._headers };
    if (this._cookies.size > 0) {
      headers["cookie"] = [...this._cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    return headers;
  }

  /** Write `data` into a new session with the app's driver, and keep its cookie. */
  private async _startSession(data: Record<string, unknown>): Promise<void> {
    let driver: SessionDriverLike | undefined;
    try {
      // The binding is declared by the session package, which this one does not depend on, so
      // its name is not among the container's typed tokens here.
      const container = this._container();
      driver = (await Reflect.apply(container.make, container, ["session.driver"])) as
        SessionDriverLike | undefined;
    } catch {
      driver = undefined;
    }
    if (!driver || typeof driver.saveSession !== "function") {
      throw new Error(
        "[FlowTest] The session option needs a `session.driver` binding: boot the app, with " +
          "SessionProvider registered, before mounting.",
      );
    }
    const response = new Response();
    await driver.saveSession(crypto.randomUUID(), data, response);
    for (const cookie of response.headers.getSetCookie()) this._keepCookie(cookie);
  }

  /** Collect the cookies an action held for the browser, as the client does. */
  private _relay(token: string): void {
    for (const cookie of _sessionRelayResponse(token).headers.getSetCookie()) {
      this._keepCookie(cookie);
    }
  }

  /** Keep one `Set-Cookie` the way a browser does, dropping a cookie it expires. */
  private _keepCookie(line: string): void {
    const [pair = "", ...attributes] = line.split(";");
    const index = pair.indexOf("=");
    if (index <= 0) return;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    const expired = attributes.some((a) => /^\s*max-age=0\s*$/i.test(a));
    if (expired || value === "") this._cookies.delete(name);
    else this._cookies.set(name, value);
  }

  // ── HTML assertions ────────────────────────────────────────────────────────

  /**
   * Assert the rendered HTML contains the given string.
   * @category Assertions
   */
  assertSee(text: string): this {
    if (!this._html.includes(text)) {
      throw new Error(
        `[FlowTest] Expected to see "${text}" but it was not found in:\n${this._html}`,
      );
    }
    return this;
  }

  /**
   * Assert the rendered HTML does NOT contain the given string.
   * @category Assertions
   */
  assertDontSee(text: string): this {
    if (this._html.includes(text)) {
      throw new Error(`[FlowTest] Expected NOT to see "${text}" but it was found in the HTML.`);
    }
    return this;
  }

  // ── Redirect assertions ────────────────────────────────────────────────────

  /**
   * Assert the last action — or the mount — redirected to the given URL.
   * @category Assertions
   */
  assertRedirectedTo(url: string): this {
    const actual = this._effects?.redirectUrl;
    if (actual !== url) {
      throw new Error(`[FlowTest] Expected redirect to "${url}" but got: ${actual ?? "(none)"}`);
    }
    return this;
  }

  /**
   * Assert the last action did NOT redirect.
   * @category Assertions
   */
  assertNotRedirected(): this {
    if (this._effects?.redirectUrl) {
      throw new Error(`[FlowTest] Expected no redirect but got: ${this._effects.redirectUrl}`);
    }
    return this;
  }

  // ── Validation assertions ──────────────────────────────────────────────────

  /**
   * Assert that a validation error exists for the given field, optionally that one of
   * its messages contains `message`.
   * @category Assertions
   */
  assertHasErrors(field: string, message?: string): this {
    const errors = this._errors;
    if (!errors[field] || errors[field]!.length === 0) {
      throw new Error(`[FlowTest] Expected validation error for "${field}" but none found.`);
    }
    if (message && !errors[field]!.some((m) => m.includes(message))) {
      throw new Error(
        `[FlowTest] Expected error for "${field}" to contain "${message}" but got: ${errors[field]!.join(", ")}`,
      );
    }
    return this;
  }

  /**
   * Assert no validation errors exist.
   * @category Assertions
   */
  assertNoErrors(): this {
    const count = Object.keys(this._errors).length;
    if (count > 0) {
      const summary = Object.entries(this._errors)
        .map(([f, msgs]) => `  ${f}: ${msgs.join(", ")}`)
        .join("\n");
      throw new Error(`[FlowTest] Expected no validation errors but found:\n${summary}`);
    }
    return this;
  }

  // ── Flash assertions ───────────────────────────────────────────────────────

  /**
   * The full flash payloads emitted by the last action (title/position/duration/…).
   * @category Assertions
   */
  flashes(): FlowEffects["flashes"] {
    return this._effects?.flashes ?? [];
  }

  /**
   * Assert a flash notification was emitted, optionally filtered by `level` and/or a
   * substring of its `message`.
   * @category Assertions
   */
  assertFlashed(level?: string, message?: string): this {
    const flashes = this._effects?.flashes ?? [];
    const match = flashes.find(
      (f) => (!level || f.level === level) && (!message || f.message.includes(message)),
    );
    if (!match) {
      const desc = [level, message].filter(Boolean).join("/");
      throw new Error(
        `[FlowTest] Expected flash "${desc}" but flashes were: ${JSON.stringify(flashes)}`,
      );
    }
    return this;
  }

  // ── Event assertions ───────────────────────────────────────────────────────

  /**
   * Assert a cross-component event was dispatched by the last action.
   * @category Assertions
   */
  assertDispatched(eventName: string): this {
    const events = this._effects?.events ?? [];
    if (!events.some((e) => e.name === eventName)) {
      throw new Error(
        `[FlowTest] Expected event "${eventName}" to be dispatched but it wasn't. Events: ${events.map((e) => e.name).join(", ") || "(none)"}`,
      );
    }
    return this;
  }

  // ── State accessors ────────────────────────────────────────────────────────

  /**
   * The page's own rendered markup, from the last render: what is inside its
   * `[data-flow-root]`, without the layout around it.
   * @category State
   */
  html(): string {
    return this._html;
  }

  /**
   * The whole document the mount was answered with: the layout, the `<head>`, the page and
   * its state island. Actions patch the page alone, so this stays the first render.
   * @category State
   */
  document(): string {
    return this._document;
  }

  /**
   * What the last action did, read off the frames the server sent back: flashes, events,
   * redirect, downloads, scripts, title. `null` before the first action, unless the mount
   * redirected.
   * @category State
   */
  effects(): FlowEffects | null {
    return this._effects;
  }

  /**
   * Every frame the server sent back for the last action, parsed, in order — the patch,
   * flashes, events, a redirect or an error, as the browser would receive them.
   * @category State
   */
  frames(): ReadonlyArray<{ type: string } & Record<string, unknown>> {
    return this._frames;
  }

  /**
   * The signed snapshot the next action is sent with.
   * @category State
   */
  snapshot(): Snapshot | null {
    return this._snapshot;
  }

  /**
   * The page as the server rebuilds it for the next action: a fresh instance with the
   * snapshot's state restored. A field that is neither `@expose`d nor `@locked` holds its
   * initial value here, whatever the last action set it to.
   *
   * For a page with no snapshot (static, or a mount that redirected) it is the instance the
   * mount built.
   * @category State
   */
  page(): T {
    return this._page;
  }

  /**
   * The validation errors the last action sent with its patch.
   * @category State
   */
  errors(): Record<string, string[]> {
    return this._errors;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Nothing happened yet. */
function _noEffects(): FlowEffects {
  return {
    flashes: [],
    redirectUrl: null,
    shouldRefresh: false,
    scripts: [],
    errors: {},
    events: [],
    downloads: [],
    title: null,
  };
}

/** The properties a snapshot carries for this page. */
function _serializedKeys(page: Component): Set<string> {
  const computed = getComputedKeys(page);
  const transient = getTransientKeys(page);
  return new Set(
    [...getExposedProps(page), ...getLockedProps(page)].filter(
      (key) => !computed.has(key) && !transient.has(key),
    ),
  );
}

/**
 * The route the page is served at, which its actions are sent to.
 *
 * A routed page (`Router.flow()` or a file route) keeps the route it was registered with. A
 * class served at several routes is registered under the last of them, so when the test's URL
 * does not match that one, the one Flow page route that does match it is taken instead.
 *
 * A page with no route of its own is registered under a path no route serves, so its actions
 * find it and run no middleware but the persistent kind — never that of whatever route
 * happens to sit at the URL the test asked for.
 */
/**
 * Pages of the app that a test-only page of the same name took the registry over from, by name.
 * The app's page gets its entry back, route middleware included, when it is mounted again.
 */
const _displacedPages = new Map<string, NonNullable<ReturnType<typeof getPage>>>();

function _routeOf(PageClass: PageClass<Component>, url: string | undefined): string {
  let entry = getPage(PageClass.name);
  const displaced = _displacedPages.get(PageClass.name);
  if (displaced && displaced.PageClass === (PageClass as unknown) && entry !== displaced) {
    _getPageEntries().set(PageClass.name, displaced);
    _displacedPages.delete(PageClass.name);
    entry = displaced;
  }
  if (entry && entry.PageClass === (PageClass as unknown)) {
    if (url === undefined) return entry.path;
    const pathname = new URL(url, ORIGIN).pathname;
    if (_matchRoute(entry.path, pathname)) return entry.path;
    const served = [...Router.routes.values()].filter(
      (route) =>
        route.method === "GET" &&
        route.controller.name === "FlowPageHandler" &&
        _matchRoute(route.path, pathname) !== null,
    );
    return served.length === 1 ? served[0]!.path : entry.path;
  }
  const path = `/__flowtest/${encodeURIComponent(PageClass.name)}`;
  // The registry is keyed by class name and holds the abstract `Component` type; any concrete
  // subclass is one. Test files declare pages of the same name (`ListPage`) far more often than
  // an app does, and a page with no route is the test's own: it takes the name over for the
  // test, where the app's registration would refuse it as a collision. Registering it the usual
  // way also registers its models.
  // An app's page it takes the name from is kept, and given back when that page is mounted.
  if (entry) {
    if (!_isTestRoute(entry.path)) _displacedPages.set(PageClass.name, entry);
    _getPageEntries().delete(PageClass.name);
  }
  registerPage(path, PageClass as unknown as typeof Component);
  return path;
}

/** Whether `path` is a route FlowTest made up for a page that has none. */
function _isTestRoute(path: string): boolean {
  return path.startsWith("/__flowtest/");
}

/** A route pattern with its optional segments dropped, for a page mounted without a URL. */
function _concretePath(pattern: string): string {
  if (!pattern.includes(":") && !pattern.includes("*")) return pattern || "/";
  const segments = pattern.split("/").filter((s) => s !== "" && !s.endsWith("?"));
  if (segments.some((s) => s.startsWith(":") || s.includes("*"))) {
    throw new Error(
      `[FlowTest] The page is routed at ${pattern}; pass a URL to mount it at, ` +
        `e.g. { url: "${pattern.replace(/:([A-Za-z0-9_]+)\??/g, "1")}" }.`,
    );
  }
  return `/${segments.join("/")}`;
}

/** The segments `pathname` gives a route `pattern`'s `:params`, or `null` when it does not match. */
function _matchRoute(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split("/").filter(Boolean);
  const have = pathname.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const segment = want[i]!;
    const value = have[i];
    if (segment.startsWith("*")) {
      params[segment.slice(1) || "*"] = have.slice(i).map(decodeURIComponent).join("/");
      return params;
    }
    if (segment.startsWith(":")) {
      const optional = segment.endsWith("?");
      const name = segment.slice(1, optional ? -1 : undefined);
      if (value === undefined) {
        if (optional) continue;
        return null;
      }
      params[name] = decodeURIComponent(value);
      continue;
    }
    if (segment !== value) return null;
  }
  return have.length > want.length ? null : params;
}

/**
 * The page's id and snapshot in a rendered document, or `null` for a static page.
 *
 * The page's root is the first `[data-flow-root]` named after its class: children render
 * their own roots, and their own state islands, inside it.
 */
function _pageState(document: string, name: string): Snapshot | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const root = new RegExp(
    `<div data-flow-root x-data="\\{\\}" data-flow-id="([^"]+)" data-flow-name="${escaped}">`,
  ).exec(document);
  if (!root) return null;
  const island = `<script type="application/json" id="flow-state-${root[1]}">`;
  const at = document.lastIndexOf(island);
  if (at === -1) return null;
  const start = at + island.length;
  return JSON.parse(document.slice(start, document.indexOf("</script>", start))) as Snapshot;
}

/**
 * The page's own markup inside a whole document: the contents of its `[data-flow-root]` (or,
 * for a static page, its `[data-flow-page]`), found by matching the wrapper's `<div>`s.
 */
function _rootHtml(document: string, id: string | undefined): string {
  const marker = id !== undefined ? `data-flow-id="${id}"` : "<div data-flow-page>";
  const at = document.indexOf(marker);
  if (at === -1) return "";
  const start = document.indexOf(">", at) + 1;
  const tag = /<div[\s>/]|<\/div>/g;
  tag.lastIndex = start;
  let depth = 1;
  for (let m = tag.exec(document); m; m = tag.exec(document)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return document.slice(start, m.index);
  }
  return document.slice(start);
}

/** A patch's markup without the `[data-flow-root]` wrapper the handler puts around it. */
function _unwrapRoot(html: string, id: string, name: string): string {
  const open = `<div data-flow-root x-data="{}" data-flow-id="${id}" data-flow-name="${name}">`;
  if (html.startsWith(open) && html.endsWith("</div>")) {
    return html.slice(open.length, -"</div>".length);
  }
  return html;
}

/**
 * Mark a harness's identity step persistent for the length of one action, so the action
 * handler keeps it in the middleware it re-runs. It is only ever in the harness's own list.
 */
function _holdIdentity(identity: MiddlewareClass): void {
  const uses = _heldIdentities.get(identity) ?? 0;
  _heldIdentities.set(identity, uses + 1);
  if (!FlowProvider.persistentMiddleware.includes(identity)) {
    FlowProvider.persistMiddleware(identity);
  }
}

/** Undo {@link _holdIdentity} once its last action is done. */
function _releaseIdentity(identity: MiddlewareClass): void {
  const uses = (_heldIdentities.get(identity) ?? 1) - 1;
  if (uses > 0) {
    _heldIdentities.set(identity, uses);
    return;
  }
  _heldIdentities.delete(identity);
  const list = FlowProvider.persistentMiddleware;
  const index = list.indexOf(identity);
  if (index !== -1) list.splice(index, 1);
}

// ── Re-export hydrate for advanced use ────────────────────────────────────────
export { hydrate } from "./dehydrate.ts";
