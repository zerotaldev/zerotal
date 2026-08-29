/**
 * Named helper exports — importable, tree-shakeable, never globals. Import from
 * `@zerotal/core/helpers`.
 *
 * A grab-bag of small, dependency-free utilities used throughout an application:
 * path resolution ({@link basePath}), environment-variable access
 * ({@link env}, {@link requireEnv}, {@link setAppEnv}), value-flow combinators
 * ({@link tap}, {@link tapAsync}, {@link pipe}, {@link pipeAsync}), error
 * suppression ({@link rescue}, {@link rescueSync}), safe nested lookups
 * ({@link data_get}), the {@link Str} string helper, and {@link markdownPage}
 * for rendering standalone Markdown documents.
 *
 * @example
 * import { env, requireEnv, tap, data_get } from '@zerotal/core/helpers';
 *
 * const debug   = env('APP_DEBUG', false);          // boolean, coerced
 * const appKey  = requireEnv('APP_KEY');            // throws if unset
 * const city    = data_get(payload, 'user.address.city', 'Unknown');
 * const user    = tap(await User.create(data), (u) => log(`created ${u.id}`));
 *
 * @packageDocumentation
 */
import { join } from "node:path";
import { ConfigError } from "../errors/ConfigError.ts";
import {
  DEPLOY_ENV_VAR,
  RUNTIME_MODES as _RUNTIME_MODES,
  RUNTIME_MODE_VAR as _RUNTIME_MODE_VAR,
} from "../support/env.ts";

// ── basePath() ────────────────────────────────────────────────────────────────

/**
 * Resolve a path relative to the application root (`process.cwd()`).
 *
 * Use in `bootstrap/app.ts` when declaring route files or directories so paths
 * are always resolved from the project root rather than the calling file's
 * directory.
 *
 * @example
 * // bootstrap/app.ts
 * Application.create({ providers })
 *   .routing({ web: basePath('routes/web.ts') })
 *   .fileBasedRouting({ web: basePath('app/routes') });
 */
export function basePath(...segments: string[]): string {
  return join(process.cwd(), ...segments);
}

// ── setAppEnv() ───────────────────────────────────────────────────────────────

/**
 * Set `APP_TYPE` — the runtime mode — from the CLI command name. Call it in
 * `zerotal.ts` BEFORE the dynamic import of `bootstrap/app.ts`, so
 * `Application.create()` sees the mode it should boot providers for.
 *
 * **`APP_ENV` is not touched.** That variable holds the deployment name the
 * operator set, and it is what answers "is this production?". The two used to
 * share one variable and the mode won, so `APP_ENV=production` read back as
 * `"console"` in every CLI command — see {@link RUNTIME_MODE_VAR}.
 *
 * An `APP_TYPE` already in the environment wins over the command, which is how
 * the dev orchestrator boots a supervised server as `web`.
 *
 * | Command              | APP_TYPE  |
 * |----------------------|-----------|
 * | serve / start / s    | web       |
 * | dev / d              | web       |
 * | worker / queue:work  | worker    |
 * | anything else        | console   |
 *
 * @example
 * // zerotal.ts
 * import { setAppEnv, CommandRunner } from '@zerotal/core';
 * setAppEnv(process.argv[2]);
 * const { default: app } = await import('./bootstrap/app.ts');
 */
export function setAppEnv(command?: string): void {
  const normalizedCommand = (command ?? "").toLowerCase();
  // eslint-disable-next-line no-restricted-syntax -- this IS setAppEnv — reading the pre-overwrite value is the whole job
  const current = Bun.env["APP_ENV"];
  const environment = Bun.env as Record<string, string>;

  // `APP_ENV` is left alone. It holds the deployment name the operator set —
  // `production`, `staging`, `local` — and it is the only place that answers
  // "is this production?". This function used to overwrite it with the runtime
  // mode, which is why six gates asking that question of `Bun.env["APP_ENV"]`
  // read `"web"` and quietly answered no, including the weak-`APP_KEY` refusal
  // and the ORM's N+1 detector; a preserved copy patched those, and then
  // `env("APP_ENV")` still returned `"console"` inside a seeder, because the
  // copy was only ever read through `deployEnv()`.
  //
  // Two questions, two variables. The mode goes to `APP_TYPE`.
  if (current && !_RUNTIME_MODES.has(current.toLowerCase())) {
    // Still mirrored, for anything already reading the preserved copy.
    environment[DEPLOY_ENV_VAR] = current;
  }

  // Deliberately no attempt to "migrate" a legacy `APP_ENV=web` into `APP_TYPE`
  // and put a deployment name back. `RUNTIME_MODES` contains `test` — which
  // `zt test` sets as a *deployment* name — so the two sets overlap and any
  // rewrite here would eventually clobber the one thing this change exists to
  // protect. `runtimeMode()` reads the legacy location instead, where a wrong
  // guess costs a mode rather than an environment.

  // An explicit `APP_TYPE` wins: it is how the dev orchestrator tells the server
  // it supervises to boot as `web` regardless of the command that started it.
  const explicit = environment[_RUNTIME_MODE_VAR];
  if (explicit && _RUNTIME_MODES.has(explicit.toLowerCase())) return;

  if (["serve", "start", "s", "dev", "d"].includes(normalizedCommand)) {
    // `dev` belongs here with `serve`, and the reason is not cosmetic. Dev mode's
    // process 1 boots the app purely to ask its providers what to run, and a
    // provider is only asked if `static environments` includes the mode it booted
    // under. Falling through to "console" below would silently drop every
    // web-only provider — no error, no empty tab, just a process that never
    // appears — and would make `zt dev` and `serve --dev` disagree about what
    // dev mode consists of.
    environment[_RUNTIME_MODE_VAR] = "web";
  } else if (["worker", "queue:work"].includes(normalizedCommand)) {
    environment[_RUNTIME_MODE_VAR] = "worker";
  } else {
    environment[_RUNTIME_MODE_VAR] = "console";
  }
}

/**
 * Read an environment variable with an optional typed fallback.
 *
 * @example
 * env('APP_NAME', 'Zerotal App')   // string
 * env('APP_DEBUG', false)        // boolean (coerces 'true'/'false' strings)
 * env('PORT', 3000)              // number  (coerces numeric strings)
 * env('APP_KEY')                 // string | undefined — no fallback
 */
export function env(key: string): string | undefined;
export function env(key: string, fallback: string): string;
export function env(key: string, fallback: boolean): boolean;
export function env(key: string, fallback: number): number;
export function env(
  key: string,
  fallback?: string | boolean | number,
): string | boolean | number | undefined {
  const raw = Bun.env[key];

  if (raw === undefined) return fallback;

  // Coerce to match fallback type
  if (typeof fallback === "boolean") {
    return raw === "true" || raw === "1";
  }
  if (typeof fallback === "number") {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return raw;
}

/**
 * Read a required environment variable.
 * Throws ConfigError if the variable is not set.
 *
 * @example
 * requireEnv('APP_KEY') // throws at boot if APP_KEY is missing
 */
export { Str } from "./str.ts";

export function requireEnv(key: string): string {
  const value = Bun.env[key];
  if (!value) {
    throw new ConfigError(`Required environment variable "${key}" is not set.`);
  }
  return value;
}

// ── tap() / tapAsync() ────────────────────────────────────────────────────────

/**
 * Pass a value to a callback and return the original value.
 * Great for side-effects (logging, events) in the middle of a chain.
 *
 * @example
 * return tap(await User.create(data), (user) => Events.emit(new UserRegistered(user.id)));
 */
export function tap<T>(value: T, callback: (val: T) => void): T {
  callback(value);
  return value;
}

/**
 * Async version of tap. Awaits the callback then returns the original value.
 *
 * @example
 * return await tapAsync(await User.create(data), async (user) => {
 *   await Notification.send(user, new WelcomeEmail());
 * });
 */
export async function tapAsync<T>(value: T, callback: (val: T) => Promise<void>): Promise<T> {
  await callback(value);
  return value;
}

// ── pipe() / pipeAsync() ──────────────────────────────────────────────────────

/**
 * Pass a value to a transformation function and return its result.
 * The sibling of tap — use pipe when the value should change, tap when it shouldn't.
 *
 * @example
 * const slug = pipe(post.title, (t) => t.toLowerCase().replace(/\s+/g, '-'));
 */
export function pipe<T, R>(value: T, fn: (val: T) => R): R {
  return fn(value);
}

/**
 * Async version of pipe.
 *
 * @example
 * const hashed = await pipeAsync(password, (p) => bcrypt.hash(p, 12));
 */
export async function pipeAsync<T, R>(value: T, fn: (val: T) => Promise<R>): Promise<R> {
  return fn(value);
}

// ── rescue() ──────────────────────────────────────────────────────────────────

/**
 * Execute a callback and return its value. On exception, return `fallback`
 * instead of propagating. Fallback may itself be a function that receives
 * the caught error.
 *
 * @example
 * const price = await rescue(() => stripe.getPrice(id), 0);
 * const user  = await rescue(() => User.findOrFail(id), (e) => { log(e); return null; });
 */
export async function rescue<T>(
  callback: () => Promise<T> | T,
  fallback: T | ((error: unknown) => T | Promise<T>),
): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    return typeof fallback === "function"
      ? (fallback as (error: unknown) => T | Promise<T>)(error)
      : fallback;
  }
}

/**
 * Synchronous sibling of `rescue` — for code paths that cannot await (JSON
 * parsing, attribute decoding, hot loops). Runs `callback` and returns its
 * value; on exception returns `fallback` (or the result of calling it with the
 * caught error).
 *
 * @example
 * const payload = rescueSync(() => JSON.parse(raw), {});
 * const cursor  = rescueSync(() => JSON.parse(atob(token)), null);
 */
export function rescueSync<T>(callback: () => T, fallback: T | ((error: unknown) => T)): T {
  try {
    return callback();
  } catch (error) {
    return typeof fallback === "function" ? (fallback as (error: unknown) => T)(error) : fallback;
  }
}

// ── data_get() ────────────────────────────────────────────────────────────────

/**
 * Safely read a deeply nested value using dot-notation.
 * Returns `defaultValue` (default `undefined`) if any segment is absent.
 *
 * Designed for untyped JSON payloads (webhooks, external API responses) where
 * optional chaining would be excessively verbose.
 *
 * @example
 * data_get(payload, 'user.address.city')          // 'Cape Town' or undefined
 * data_get(payload, 'items.0.price', 0)           // first item's price or 0
 */
export function data_get(target: unknown, key: string, defaultValue?: unknown): unknown {
  if (target === undefined || target === null) return defaultValue;
  const keys = key.split(".");
  let current = target as Record<string, unknown>;
  for (const segment of keys) {
    if (current === undefined || current === null) return defaultValue;
    current = (current as Record<string, unknown>)[segment] as Record<string, unknown>;
  }
  return current !== undefined ? current : defaultValue;
}

export { markdownPage, type BunMarkdownOptions } from "./markdown.ts";

// ── Shared framework helpers — canonical home ────────────────────────────────
// The one HTML escaper (both JSX runtimes render through it), the English
// inflector the convention layer builds table names with, deep config merging,
// and request-cookie parsing. Import from `@zerotal/core/helpers`; packages
// must not carry private copies.
export { escapeHtml } from "./html.ts";
export { pluralize, singularize, tableNameFor } from "../support/str.ts";
export { deepMerge, definedOnly } from "../support/deepMerge.ts";
export type { Resolved } from "../support/deepMerge.ts";
export { parseCookieHeader } from "../support/cookie.ts";
