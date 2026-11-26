/**
 * Per-test overrides of environment variables and config that put themselves back.
 *
 * `Bun.env` is one object for the whole process, and `bun test` runs every test file
 * in that process. Config resolves once, when the app boots, and the shared test app
 * boots once per process. So a test that turns a feature on — `Bun.env.FEATURE_X =
 * "1"`, `config.set("app.secureHeaders.contentSecurityPolicy", …)` — leaves it on for
 * every test and every file that runs after it, unless it restores the old value in
 * a `finally` nobody forgets. When somebody does forget, the failure shows up in a
 * different file, on one platform, in an order that changes when files are added.
 *
 * Both helpers come in two forms:
 *
 * - **Scoped** — `await withEnv({ … }, async () => { … })`: the override holds for
 *   the callback and is undone in a `finally`, whether it returns or throws.
 * - **Per test** — `withEnv({ … })` at the top of a `describe`: applied before each
 *   test in it and undone after each one.
 *
 * Config is overridden in place, on the live store, so code that reads config per
 * request — the security-headers middleware reads `app.secureHeaders` on every
 * request, CSP included — sees the override. A value an app computed from an env
 * variable while its config file loaded is already fixed by then: override the
 * config key it produced with `withConfig()`, not the variable with `withEnv()`.
 *
 * @module
 */
import type { Application } from "@zerotal/core";
import { currentApp } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";

/** What `withConfig()` writes into: the live config store of the current app. */
export interface WithConfigOptions {
  /** The app whose config to override. Default: the current app (`currentApp()`). */
  app?: Application | undefined;
}

interface Hooks {
  beforeEach(fn: () => void | Promise<void>): void;
  afterEach(fn: () => void | Promise<void>): void;
}

function _hooks(helper: string): Hooks {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("bun:test") as Hooks;
  } catch {
    throw new Error(
      `[Zerotal] ${helper}() without a callback registers beforeEach/afterEach hooks, ` +
        `so it can only be used inside a \`bun test\` run.`,
    );
  }
}

/** Apply an override, run `fn`, undo the override whatever happens. */
async function _scoped<T>(apply: () => () => void, fn: () => T | Promise<T>): Promise<T> {
  const undo = apply();
  try {
    return await fn();
  } finally {
    undo();
  }
}

/** Register `apply` before each test and its undo after each one. */
function _perTest(helper: string, apply: () => () => void): void {
  const { beforeEach, afterEach } = _hooks(helper);
  let undo: (() => void) | undefined;
  beforeEach(() => {
    undo = apply();
  });
  afterEach(() => {
    undo?.();
    undo = undefined;
  });
}

// ── withEnv ───────────────────────────────────────────────────────────────────

/**
 * Set environment variables for one test, then put back exactly what was there.
 *
 * A value of `undefined` unsets the variable for the duration. Afterwards each
 * variable has its old value again, and one that was unset before is unset again
 * rather than left as an empty string.
 *
 * @example
 * ```ts
 * // For one block:
 * await withEnv({ FEATURE_BILLING: "1" }, async () => {
 *   const res = await app.get("/billing");
 *   res.assertOk();
 * });
 *
 * // For every test in a describe:
 * describe("billing", () => {
 *   withEnv({ FEATURE_BILLING: "1" });
 *   it("is on", () => { … });
 * });
 * ```
 */
export function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T>;
export function withEnv(vars: Record<string, string | undefined>): void;
export function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn?: () => T | Promise<T>,
): Promise<T> | void {
  const apply = () => _applyEnv(vars);
  if (fn) return _scoped(apply, fn);
  _perTest("withEnv", apply);
}

function _applyEnv(vars: Record<string, string | undefined>): () => void {
  const env = Bun.env as Record<string, string | undefined>;
  const before = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(vars)) {
    before.set(name, Object.prototype.hasOwnProperty.call(env, name) ? env[name] : undefined);
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return () => {
    for (const [name, value] of before) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  };
}

// ── withConfig ────────────────────────────────────────────────────────────────

/**
 * Override config values (by dot path) for one test, then put back exactly what was
 * there.
 *
 * Keys are dot paths, as `config()` reads them. A path that did not exist before is
 * removed again afterwards, together with any intermediate objects the override had
 * to create.
 *
 * @example
 * ```ts
 * await withConfig({ "app.secureHeaders.contentSecurityPolicy": "default-src 'none'" }, async () => {
 *   const res = await app.get("/");
 *   res.assertHeader("content-security-policy", "default-src 'none'");
 * });
 *
 * describe("with registration closed", () => {
 *   withConfig({ "auth.registration": false });
 *   it("hides the sign-up link", async () => { … });
 * });
 * ```
 */
export function withConfig<T>(
  overrides: Record<string, unknown>,
  fn: () => T | Promise<T>,
  options?: WithConfigOptions,
): Promise<T>;
export function withConfig(overrides: Record<string, unknown>, options?: WithConfigOptions): void;
export function withConfig<T>(
  overrides: Record<string, unknown>,
  fnOrOptions?: (() => T | Promise<T>) | WithConfigOptions,
  maybeOptions?: WithConfigOptions,
): Promise<T> | void {
  const fn = typeof fnOrOptions === "function" ? fnOrOptions : undefined;
  const options = (typeof fnOrOptions === "function" ? maybeOptions : fnOrOptions) ?? {};
  // Resolved when the override applies, not when it is declared: a per-test
  // override is declared before the app it targets has booted.
  const apply = () => _applyConfig(_configOf(options.app), overrides);
  if (fn) return _scoped(apply, fn);
  _perTest("withConfig", apply);
}

function _configOf(app: Application | undefined): ConfigManager {
  return (app ?? currentApp()).container.makeSync("config") as ConfigManager;
}

function _applyConfig(config: ConfigManager, overrides: Record<string, unknown>): () => void {
  const undos: Array<() => void> = [];
  for (const [path, value] of Object.entries(overrides)) undos.push(_setOne(config, path, value));
  // Undone in reverse, so two overrides of overlapping paths unwind correctly.
  return () => {
    for (const undo of undos.reverse()) undo();
  };
}

/** Set one path and return what puts it back. */
function _setOne(config: ConfigManager, path: string, value: unknown): () => void {
  const keys = path.split(".");
  // The shallowest prefix that does not exist yet as an object: set() creates it and
  // everything below it, so removing it removes all of them.
  let created: number | undefined;
  for (let depth = 1; depth < keys.length; depth++) {
    const node = config.get(keys.slice(0, depth).join("."));
    if (node === undefined || node === null || typeof node !== "object") {
      created = depth;
      break;
    }
  }
  const parentPath = keys.slice(0, -1).join(".");
  const leaf = keys.at(-1)!;
  const parent = parentPath === "" ? undefined : config.get<Record<string, unknown>>(parentPath);
  const existed =
    created === undefined &&
    (parent === undefined ? config.has(path) : Object.prototype.hasOwnProperty.call(parent, leaf));
  const previous = config.get(path);

  config.set(path, value);

  return () => {
    if (existed) {
      config.set(path, previous);
      return;
    }
    if (created !== undefined) {
      _remove(config, keys.slice(0, created));
      return;
    }
    _remove(config, keys);
  };
}

/** Delete the property at `keys`; a top-level namespace is reset to undefined. */
function _remove(config: ConfigManager, keys: string[]): void {
  if (keys.length === 1) {
    config.set(keys[0]!, undefined);
    return;
  }
  const parent = config.get<Record<string, unknown> | undefined>(keys.slice(0, -1).join("."));
  if (parent && typeof parent === "object") delete parent[keys.at(-1)!];
}
