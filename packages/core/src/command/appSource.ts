/**
 * What the `make:*` generators need to know about the app they write into, so a generated file
 * passes the app's own checks as it stands.
 *
 * A generator that wrote `import { BaseModel } from '@zerotal/orm'` into a starter produced a
 * file the starter's `bun run format:check` rejected (the starters use double quotes) and that
 * imported a package the app does not declare (the starters depend on the `zerotal` bundle and
 * reach the stable packages through its subpaths). Each generator now asks this module how the
 * app imports the framework, and writes through the app's own formatter when it has one.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

/** The parts of an app's `package.json` a generator reads. */
interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readManifest(cwd: string): Manifest | undefined {
  try {
    return JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as Manifest;
  } catch {
    return undefined;
  }
}

function declares(manifest: Manifest | undefined, name: string): boolean {
  return (
    manifest?.dependencies?.[name] !== undefined || manifest?.devDependencies?.[name] !== undefined
  );
}

/**
 * The scoped packages the `zerotal` bundle re-exports, each under the subpath it uses.
 *
 * `@zerotal/core` is the bundle's root. The rest are installed individually under their own
 * names (`@zerotal/notifications`, `@zerotal/flow`, …), so their imports stay scoped.
 *
 * @internal Exported for the test that keeps it in step with the bundle's `exports`.
 */
export const _BUNDLED: Readonly<Record<string, string>> = {
  "@zerotal/core": "zerotal",
  "@zerotal/auth": "zerotal/auth",
  "@zerotal/cache": "zerotal/cache",
  "@zerotal/client": "zerotal/client",
  "@zerotal/media": "zerotal/media",
  "@zerotal/orm": "zerotal/orm",
  "@zerotal/queue": "zerotal/queue",
  "@zerotal/scheduler": "zerotal/scheduler",
  "@zerotal/session": "zerotal/session",
  "@zerotal/testing": "zerotal/testing",
  "@zerotal/validator": "zerotal/validator",
};

/**
 * The specifier a generated file should import a framework package by, in the app at `cwd`.
 *
 * An app that declares the `zerotal` bundle — every starter does — imports the stable packages
 * through it: `@zerotal/orm` is `zerotal/orm`. An app that declares the scoped packages instead
 * (and not the bundle) gets the scoped name. With no `package.json` to read, the bundle is
 * assumed, since that is what a new app has.
 *
 * @internal
 */
export function _frameworkImport(scoped: string, cwd: string = process.cwd()): string {
  const bundled = _BUNDLED[scoped];
  if (!bundled) return scoped;
  const manifest = readManifest(cwd);
  if (manifest === undefined || declares(manifest, "zerotal")) return bundled;
  return scoped;
}

/** The subset of Prettier's API used here. */
interface Formatter {
  format(source: string, options: Record<string, unknown>): Promise<string>;
  resolveConfig(file: string): Promise<Record<string, unknown> | null>;
  getFileInfo(file: string, options: { ignorePath?: string[] }): Promise<{ ignored: boolean }>;
}

/**
 * `source` formatted the way the app at `cwd` formats its files: with the Prettier it declares,
 * under its own config and ignore file. Unchanged when the app has no Prettier, ignores the
 * file, or Prettier cannot parse it (the file is still written; the app's check will say why).
 *
 * @internal
 */
export async function _formatAppSource(
  path: string,
  source: string,
  cwd: string = process.cwd(),
): Promise<string> {
  if (!declares(readManifest(cwd), "prettier")) return source;
  try {
    const entry = Bun.resolveSync("prettier", cwd);
    const mod = (await import(entry)) as Formatter & { default?: Formatter };
    const prettier = typeof mod.format === "function" ? mod : mod.default;
    if (!prettier) return source;
    const file = isAbsolute(path) ? path : join(cwd, path);
    const ignorePath = [".prettierignore", ".gitignore"]
      .map((name) => join(cwd, name))
      .filter((p) => existsSync(p));
    const info = await prettier.getFileInfo(file, { ignorePath });
    if (info.ignored) return source;
    const options = (await prettier.resolveConfig(file)) ?? {};
    return await prettier.format(source, { ...options, filepath: file });
  } catch {
    return source;
  }
}

/**
 * Writes a generated file into the app, formatted as the app formats its own files.
 *
 * @internal
 */
export async function _writeAppSource(
  path: string,
  source: string,
  cwd: string = process.cwd(),
): Promise<void> {
  // Bun.write() creates any missing parent directories, so no mkdir is needed.
  await Bun.write(path, await _formatAppSource(path, source, cwd));
}

/**
 * One column a model declares with `@column`.
 *
 * @internal
 */
export interface _ModelColumn {
  /** The property name, e.g. `userId`. */
  property: string;
  /** The database column, e.g. `user_id`. */
  column: string;
  /** The declared TypeScript type without `null`/`undefined`, e.g. `string`. */
  type: string;
  /** The column may be null (declared optional, or with `null` in its type). */
  nullable: boolean;
}

/**
 * What a generator reads from a model's source.
 *
 * @internal
 */
export interface _ModelShape {
  /** The model's file, without extension, relative to the app root. */
  file: string;
  columns: _ModelColumn[];
  /** The mass-assignable columns, by property name, in declaration order. */
  fillable: string[];
  /**
   * The column that names the owning user (`userId`), when the model has one. A generated page
   * or test scopes the model to the signed-in user through it.
   */
  owner: _ModelColumn | undefined;
}

function snake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * Reads the columns a model declares, from its source in `app/models/`, without importing it.
 *
 * A generator runs with no app booted, and importing a model would run its decorators against
 * no database. The `@column` lines are regular enough to read: `@column(…) name!: string;`.
 * Returns `undefined` when no file in `app/models/` exports the class.
 *
 * @internal
 */
export function _readModel(name: string, cwd: string = process.cwd()): _ModelShape | undefined {
  const dir = join(cwd, "app", "models");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
  } catch {
    return undefined;
  }
  const declaresClass = new RegExp(`export\\s+(?:abstract\\s+)?class\\s+${name}\\b`);
  const exact = files.find((f) => f.replace(/\.tsx?$/, "") === name);
  const ordered = exact ? [exact, ...files.filter((f) => f !== exact)] : files;
  for (const file of ordered) {
    const source = readFileSync(join(dir, file), "utf8");
    if (!declaresClass.test(source)) continue;
    const columns: _ModelColumn[] = [];
    const columnLine =
      /@column\s*\(([^)]*)\)\s*(?:declare\s+)?(?:public\s+)?(\w+)\s*([!?])?\s*:\s*([^;=\n]+)/g;
    for (const m of source.matchAll(columnLine)) {
      const [, args = "", property = "", mark, rawType = ""] = m;
      const parts = rawType
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);
      const type = parts.filter((p) => p !== "null" && p !== "undefined").join(" | ") || "unknown";
      const explicit = /name\s*:\s*["']([^"']+)["']/.exec(args)?.[1];
      columns.push({
        property,
        column: explicit ?? snake(property),
        type,
        nullable: mark === "?" || parts.includes("null") || /nullable\s*:\s*true/.test(args),
      });
    }
    const list = /static\s+(?:override\s+)?fillable[^=]*=\s*\[([^\]]*)\]/.exec(source)?.[1];
    const fillable = list
      ? [...list.matchAll(/["'`](\w+)["'`]/g)].map((m) => m[1]!)
      : columns.map((c) => c.property);
    const owner = columns.find((c) => c.property === "userId" || c.column === "user_id");
    return {
      file: relative(cwd, join(dir, file.replace(/\.tsx?$/, ""))).replace(/\\/g, "/"),
      columns,
      fillable,
      owner,
    };
  }
  return undefined;
}

/**
 * A relative import from the file at `from` to the module at `to` (both relative to the app
 * root, `to` without extension).
 *
 * @internal
 */
export function _relativeImport(from: string, to: string): string {
  const path = relative(dirname(from), to).replace(/\\/g, "/");
  return path.startsWith(".") ? path : `./${path}`;
}
