/**
 * The environment `zt dev` gives the processes it starts, with the app's `.env` files read again.
 *
 * A child is spawned with this process's environment, and Bun does not let a `.env` file
 * override a variable that is already set. So once `zt dev` was running, an edit to `.env`
 * reached nothing: the restarted server inherited the value the parent read at boot, and read
 * its own `.env` only for keys the parent did not already have. Each spawn now re-reads the
 * files and lays them over the inherited environment.
 *
 * A variable set in the shell still wins, as it does without `zt dev`: a key is taken from the
 * files only when the inherited value is the one the files held when `zt dev` started, which
 * is how a value that came from a file is told apart from one somebody typed.
 *
 * @module
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The `.env` files Bun loads, lowest precedence first: `.env`, the one for `NODE_ENV`
 * (`development` when unset), then `.env.local`, which Bun skips under `NODE_ENV=test`.
 *
 * @internal
 */
export function _envFileNames(nodeEnv: string | undefined): string[] {
  const mode = nodeEnv && nodeEnv !== "" ? nodeEnv : "development";
  return [".env", `.env.${mode}`, ...(mode === "test" ? [] : [".env.local"])];
}

/**
 * Parse one `.env` file's text.
 *
 * `KEY=value` lines, an optional `export `, `#` comments, single quotes taken literally,
 * double quotes with `\n` escapes, and `$KEY` / `${KEY}` expanded from keys above it or from
 * `outer`.
 *
 * @internal
 */
export function _parseEnvFile(
  text: string,
  outer: Record<string, string | undefined> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  const lookup = (key: string): string => out[key] ?? outer[key] ?? "";
  const expand = (value: string): string =>
    value.replace(/\\\$|\$\{([A-Za-z_][\w.]*)\}|\$([A-Za-z_]\w*)/g, (match, braced, bare) =>
      match === "\\$" ? "$" : lookup((braced ?? bare) as string),
    );

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][\w.-]*)\s*[=:]\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!;
    const quote = value[0];
    if ((quote === '"' || quote === "'" || quote === "`") && value.indexOf(quote, 1) !== -1) {
      value = value.slice(1, value.indexOf(quote, 1));
      if (quote === "'") {
        out[key] = value;
        continue;
      }
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    out[key] = expand(value);
  }
  return out;
}

/**
 * Every variable the app's `.env` files set, merged in Bun's order of precedence.
 *
 * @param cwd - The app root.
 * @param base - The inherited environment, for `NODE_ENV` and for `$VAR` expansion.
 * @internal
 */
export function _readEnvFiles(
  cwd: string,
  base: Record<string, string | undefined> = Bun.env,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const name of _envFileNames(base["NODE_ENV"])) {
    let text: string;
    try {
      text = readFileSync(join(cwd, name), "utf8");
    } catch {
      continue; // Not every app has every file.
    }
    Object.assign(merged, _parseEnvFile(text, { ...base, ...merged }));
  }
  return merged;
}

/**
 * Lay the `.env` files as they are now over an inherited environment.
 *
 * @param base - The environment `zt dev` itself started with.
 * @param atStart - What the files set when `zt dev` started.
 * @param now - What the files set now.
 * @returns The environment for the next child: a key the files own takes its new value, a key
 *   removed from the files is removed, and a key set in the shell keeps the shell's value.
 * @internal
 */
export function _overlayEnvFiles(
  base: Record<string, string | undefined>,
  atStart: Record<string, string>,
  now: Record<string, string>,
): Record<string, string | undefined> {
  const env = { ...base };
  const fromFiles = (key: string): boolean => !(key in base) || base[key] === atStart[key];
  for (const key of Object.keys(atStart)) {
    if (!(key in now) && base[key] === atStart[key]) delete env[key];
  }
  for (const [key, value] of Object.entries(now)) {
    if (fromFiles(key)) env[key] = value;
  }
  return env;
}

/**
 * The environment source `zt dev` spawns its processes from.
 *
 * @internal
 */
export class _DevEnv {
  private readonly _atStart: Record<string, string>;

  constructor(
    private readonly _cwd: string,
    private readonly _base: Record<string, string | undefined> = { ...Bun.env },
  ) {
    this._atStart = _readEnvFiles(_cwd, _base);
  }

  /** The inherited environment with the `.env` files, read now, laid over it. */
  current(): Record<string, string | undefined> {
    return _overlayEnvFiles(this._base, this._atStart, _readEnvFiles(this._cwd, this._base));
  }
}
