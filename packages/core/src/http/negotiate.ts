/**
 * Content negotiation: detects whether a request is a browser, API, or CLI
 * client and dispatches to the matching handler, giving each branch a context
 * tailored to that channel (session helpers for web, ANSI output for CLI, …).
 */
import type { HttpContext } from "../pipeline/HttpContext.ts";

// ── ANSI helpers ───────────────────────────────────────────────────────────────

const ANSI: Record<string, string> = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

/**
 * A supported ANSI text color for CLI output.
 *
 * @internal
 */
export type AnsiColor = "red" | "green" | "yellow" | "blue" | "cyan" | "dim";

// ── Channel detection ──────────────────────────────────────────────────────────

/** The client channel a request arrived on. */
export type Channel = "web" | "json" | "cli";

/**
 * Detect which channel the current request is coming from.
 *
 * Priority:
 * 1. `X-Zerotal-Channel: cli` — set by the Zerotal CLI binary
 * 2. CLI user-agent patterns: curl, wget, HTTPie
 * 3. `Accept: application/json` — API / SPA client
 * 4. Default: web browser
 */
export function detectChannel(ctx: HttpContext): Channel {
  if (ctx.header("X-Zerotal-Channel") === "cli") return "cli";

  const userAgent = ctx.header("User-Agent") ?? "";
  if (/^(curl|wget|httpie)\//i.test(userAgent)) return "cli";

  if (ctx.wantsJson()) return "json";

  return "web";
}

// ── Channel-specific context interfaces ───────────────────────────────────────

/**
 * Context passed to the `web` branch of `negotiate()`.
 *
 * Exposes session-aware helpers (flash, redirect-back). Session access is only
 * safe here because the web channel guarantees a Cookie-based session is present.
 */
export interface WebContext {
  readonly ctx: HttpContext;
  redirect(url: string, status?: 301 | 302 | 303 | 307 | 308): void;
  back(status?: 301 | 302 | 303 | 307 | 308): void;
  view(markup: string | { toString(): string }, status?: number): void;
  html(markup: string | { toString(): string }, status?: number): void;
  json(data: unknown, status?: number): void;
  flash(key: string, value: unknown): void;
  flashed<T = unknown>(key: string): T | undefined;
}

/**
 * Context passed to the `json` branch of `negotiate()`.
 *
 * Stateless — no session, no cookies. Caller is an API client or SPA.
 */
export interface ApiContext {
  readonly ctx: HttpContext;
  json(data: unknown, status?: number): void;
  bearerToken(): string | null;
}

/**
 * Context passed to the `cli` branch of `negotiate()`.
 *
 * Terminal-oriented. Exposes ANSI helpers and plain-text HTTP responses.
 * Session and redirect helpers are intentionally absent.
 */
export interface CliContext {
  readonly ctx: HttpContext;
  /** Set a plain-text HTTP response with explicit status. */
  text(content: string, status?: number): void;
  /** Write to stdout without affecting the HTTP response. */
  write(content: string): void;
  writeln(content: string): void;
  /** Write a colored line to stdout without affecting the HTTP response. */
  line(content: string, color?: AnsiColor): void;
  /** Set a 500 plain-text response with ANSI red message. */
  error(message: string): void;
  /** Set a 200 plain-text response with ANSI green message. */
  success(message: string): void;
  /** Set a 200 plain-text response with ANSI yellow message. */
  warn(message: string): void;
  /** Set a 200 plain-text response with ANSI blue message. */
  info(message: string): void;
}

// ── Context factories ─────────────────────────────────────────────────────────

function makeWebContext(ctx: HttpContext): WebContext {
  return {
    ctx,
    redirect: (url, status) => ctx.redirect(url, status),
    back: (status) => ctx.back(status),
    view: (markup, status) => ctx.view(markup, status),
    html: (markup, status) => ctx.html(markup, status),
    json: (data, status) => ctx.json(data, status),
    flash: (key, value) => ctx.flash(key, value),
    flashed: (key) => ctx.flashed(key),
  };
}

function makeApiContext(ctx: HttpContext): ApiContext {
  return {
    ctx,
    json: (data, status) => ctx.json(data, status),
    bearerToken: () => ctx.bearerToken(),
  };
}

function makeCliContext(ctx: HttpContext): CliContext {
  const colorize = (text: string, color: AnsiColor): string =>
    `${ANSI[color]}${text}${ANSI["reset"]}`;

  const textResponse = (content: string, status = 200): void => {
    ctx.response = new Response(content + "\n", {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  };

  return {
    ctx,
    text: textResponse,
    write: (content) => {
      process.stdout.write(content);
    },
    writeln: (content) => {
      process.stdout.write(content + "\n");
    },
    line: (content, color) => {
      process.stdout.write((color ? colorize(content, color) : content) + "\n");
    },
    error: (message) => textResponse(colorize(message, "red"), 500),
    success: (message) => textResponse(colorize(message, "green"), 200),
    warn: (message) => textResponse(colorize(message, "yellow"), 200),
    info: (message) => textResponse(colorize(message, "blue"), 200),
  };
}

// ── negotiate() ───────────────────────────────────────────────────────────────

/** The per-channel handlers passed to `negotiate()`; `cli` falls back to `json` when omitted. */
export interface NegotiateMap<TWeb = void, TJson = void, TCli = void> {
  web: (web: WebContext) => TWeb | Promise<TWeb>;
  json: (api: ApiContext) => TJson | Promise<TJson>;
  cli?: (cli: CliContext) => TCli | Promise<TCli>;
}

/**
 * Polymorphic execution primitive — routes handling to the channel-appropriate
 * closure based on how the request arrived.
 *
 * Works in controllers to return channel-appropriate responses:
 * @example
 * async store(ctx: HttpContext) {
 *   const post = await Post.create(await ctx.body());
 *   return negotiate(ctx)({
 *     web:  (w) => { w.flash('success', 'Post created!'); w.redirect('/posts'); },
 *     json: (a) => a.json({ data: post }, 201),
 *     cli:  (c) => c.success(`Post #${post.id} created.`),
 *   });
 * }
 *
 * Works in middleware to block, redirect, or pass through per channel:
 * @example
 * async handle(ctx, next) {
 *   if (!ctx.user) {
 *     await negotiate(ctx)({
 *       web:  (w) => w.redirect('/login'),
 *       json: (a) => a.json({ message: 'Unauthenticated.' }, 401),
 *       cli:  (c) => c.error('Authentication required.'),
 *     });
 *     return ctx; // short-circuit — response is already set
 *   }
 *   return next(ctx);
 * }
 *
 * When no `cli` handler is provided, CLI requests fall back to the `json` branch
 * (curl / wget users expect structured output).
 */
export function negotiate(ctx: HttpContext) {
  const channel = detectChannel(ctx);

  return async function <TWeb = void, TJson = void, TCli = void>(
    map: NegotiateMap<TWeb, TJson, TCli>,
  ): Promise<TWeb | TJson | TCli | void> {
    if (channel === "cli" && map.cli) {
      return map.cli(makeCliContext(ctx));
    }

    if (channel === "json" || channel === "cli") {
      return map.json(makeApiContext(ctx));
    }

    return map.web(makeWebContext(ctx));
  };
}
