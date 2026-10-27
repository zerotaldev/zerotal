/**
 * Synchronous loader for a `config/` directory: discovers each config file,
 * exposes its values as a namespaced map, and collects optional per-file
 * validators so configuration can be checked before the app boots.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { frameworkLog } from "../logger/frameworkLog.ts";

const requireModule = createRequire(import.meta.url);

/**
 * Namespace → config object map (filename without extension is the namespace).
 *
 * @internal
 */
export type ConfigMap = Record<string, Record<string, unknown>>;
type Validator = (value: Record<string, unknown>) => void;

/** A config file that threw while loading, and what it threw. */
export interface ConfigLoadFailure {
  /** The file name, e.g. `app.ts`. */
  file: string;
  error: unknown;
}

/** Options for {@link configLoader}. */
export interface ConfigLoaderOptions {
  /**
   * Keep a file that fails to load in {@link ConfigLoader.failures} instead of logging it at once,
   * for a caller that decides later whether anything needed it. `zt` does this: a command that
   * does not boot the app has no use for `config/app.ts`, and an `APP_KEY` it never reads should
   * not print an error in a job that succeeds.
   */
  deferFailures?: boolean | undefined;
}

/**
 * A loaded set of config files, keyed by filename (`config/app.ts` → `app`). Pass `all()` (or the
 * loader itself) to `Application.create({ config })` / `app.useConfig(...)`.
 */
export class ConfigLoader {
  constructor(
    private readonly _map: ConfigMap,
    private readonly _validators: ReadonlyArray<{ ns: string; fn: Validator }> = [],
    private readonly _failures: ReadonlyArray<ConfigLoadFailure> = [],
  ) {}

  /** The full namespace → config map. */
  all(): ConfigMap {
    return this._map;
  }

  /** Files that threw while loading, when the loader was asked to defer them; otherwise empty. */
  failures(): ReadonlyArray<ConfigLoadFailure> {
    return this._failures;
  }

  /**
   * Dot-path read, e.g. `get("database.url")`.
   *
   * @param key       Dot-notation path across the loaded namespaces.
   * @param fallback  Value returned when the path is missing.
   * @returns The stored value, or `fallback` when unset.
   */
  get<T = unknown>(key: string, fallback?: T): T {
    let current: unknown = this._map;
    for (const part of key.split(".")) {
      if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return fallback as T;
      }
    }
    return (current ?? fallback) as T;
  }

  /** Whether a value exists at the given dot-path. */
  has(key: string): boolean {
    return this.get(key, undefined as unknown) !== undefined;
  }

  /**
   * Run each config file's optional `validate(config)` named export against its value, throwing on
   * the first failure. Returns `this` for chaining. (Config files that read env at module load are
   * already validated by the act of loading.)
   *
   * @returns `this`, so the call chains into `Application.create({ config })`.
   * @throws Whatever a config file's `validate(config)` export throws on the first failure.
   */
  validate(): this {
    for (const { ns: namespace, fn: validate } of this._validators) {
      validate(this._map[namespace] ?? {});
    }
    return this;
  }
}

/**
 * Synchronously load every `*.ts` / `*.js` file in `dir` (default `./config`) into a namespace map
 * keyed by filename. Safe to call at the top level of an entry script (`zerotal.ts`) — no `await`.
 *
 * Each file's **default export** is the config object; an optional named **`validate(config)`**
 * export is collected and run by `ConfigLoader.validate()`.
 *
 * @param dir  Directory to scan, relative to `process.cwd()`. Defaults to `./config`.
 * @param options  See {@link ConfigLoaderOptions}.
 * @returns A {@link ConfigLoader} over the discovered namespaces. A missing
 * directory yields an empty loader rather than throwing.
 *
 * @example
 * ```ts
 * const config = configLoader("./config");
 * config.validate();
 * const app = Application.create({ config });   // or app.useConfig(config)
 * ```
 */
export function configLoader(dir = "./config", options: ConfigLoaderOptions = {}): ConfigLoader {
  const absoluteDirectory = path.resolve(process.cwd(), dir);
  const map: ConfigMap = {};
  const validators: Array<{ ns: string; fn: Validator }> = [];
  const failures: ConfigLoadFailure[] = [];
  try {
    const glob = new Bun.Glob("*.{ts,js}");
    for (const file of glob.scanSync({ cwd: absoluteDirectory, onlyFiles: true })) {
      const namespace = file.replace(/\.(ts|js)$/, "");
      try {
        const loadedModule = requireModule(path.join(absoluteDirectory, file)) as Record<
          string,
          unknown
        >;
        const value = loadedModule["default"] ?? loadedModule;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          map[namespace] = value as Record<string, unknown>;
        }
        if (typeof loadedModule["validate"] === "function") {
          validators.push({ ns: namespace, fn: loadedModule["validate"] as Validator });
        }
      } catch (error) {
        if (options.deferFailures) failures.push({ file, error });
        else frameworkLog("config").error(`Config "${file}" failed to load`, { file }, error);
      }
    }
  } catch {
    // A missing config/ directory is fine — minimal apps may not have one.
  }
  return new ConfigLoader(map, validators, failures);
}

/**
 * Say which config files failed to load, once a caller knows whether it needed them.
 *
 * @param failures  From {@link ConfigLoader.failures}.
 * @param needed  Whether the app booted. A booted app depends on its config, so a failure is the
 *   error it always was; a command that never boots reads at most a path or two, with defaults, so
 *   a failure is one line of context and not a red block in the log of a job that succeeds.
 * @internal
 */
export function _reportConfigFailures(
  failures: ReadonlyArray<ConfigLoadFailure>,
  needed: boolean,
): void {
  for (const { file, error } of failures) {
    if (needed) {
      frameworkLog("config").error(`Config "${file}" failed to load`, { file }, error);
    } else {
      const reason = error instanceof Error ? error.message : String(error);
      frameworkLog("config").info(
        `Config "${file}" did not load (${reason}). This command does not boot the app; anything ` +
          `it reads from that file falls back to its default.`,
        { file },
      );
    }
  }
}
