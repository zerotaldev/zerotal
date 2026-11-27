/**
 * What `bun zt repl` can reach: the app's own modules through `import()` and `use()`, the app's
 * models by name, and the common facades of the packages the app has installed.
 *
 * The REPL evaluates each line in a `node:vm` context. A context has no module loader of its own,
 * so an `import()` in it failed with "A dynamic import callback was not specified", and the only
 * things a developer or an agent could touch were the few names the REPL put on the global scope.
 * Each line is now evaluated with a loader that resolves specifiers the way the app's own files
 * do: from the project root, through its `tsconfig.json` paths, with `@app/*` meaning `app/*`
 * even in an app whose tsconfig does not declare it.
 *
 * @module
 */
import { isAbsolute, join, resolve } from "node:path";
import { _importAppFile, _scanAppFiles } from "../../support/appFiles.ts";

/** A module namespace, as `import()` returns it. */
type Namespace = Record<string, unknown>;

/** Imports a module for the REPL, resolving the specifier from the project root. */
export type _ReplImporter = (specifier: string) => Promise<Namespace>;

/** Whether a specifier names a file by path rather than a package or an alias. */
function isPathSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier === "." ||
    specifier === ".." ||
    isAbsolute(specifier) ||
    specifier.startsWith("file:")
  );
}

/**
 * Where a specifier points, from the project root at `root`: a path or `file://` URL for an app
 * file or a package, or the specifier unchanged for a built-in such as `node:path`.
 *
 * Bun's resolver, asked from the root directory, applies the root `tsconfig.json`'s `paths`, so
 * `@app/models/User` and any other alias the app declares resolve as they do in the app's own
 * files. `@app/*` is also tried as `app/*` when the tsconfig does not declare it, so `use()` reads
 * the same in every starter.
 *
 * @internal
 */
export function _resolveReplSpecifier(specifier: string, root: string): string {
  if (specifier.startsWith("node:") || specifier.startsWith("bun:") || specifier === "bun") {
    return specifier;
  }
  if (specifier.startsWith("file:")) return specifier;
  const attempts: [string, string][] = [[specifier, root]];
  if (specifier.startsWith("@app/")) {
    attempts.push([`./app/${specifier.slice("@app/".length)}`, root]);
  }
  // A bare name the root cannot see may still be one the framework itself depends on.
  if (!isPathSpecifier(specifier)) attempts.push([specifier, import.meta.dir]);
  for (const [candidate, from] of attempts) {
    try {
      return Bun.resolveSync(candidate, from);
    } catch {
      /* try the next way of reading it */
    }
  }
  throw new Error(`Cannot find module '${specifier}' from ${root}`);
}

/**
 * The loader the REPL hands to every evaluation, so `import()` inside it reaches the app.
 *
 * A file under the project root goes through {@link _importAppFile}, which a compiled binary
 * answers from the files it carries. Anything else is imported as it resolves.
 *
 * @param root - The project root: the directory `bun zt` runs in.
 * @internal
 */
export function _replImporter(root: string): _ReplImporter {
  return async (specifier) => {
    const target = _resolveReplSpecifier(specifier, root);
    if (target.startsWith("node:") || target.startsWith("bun:") || target === "bun") {
      return (await import(target)) as Namespace;
    }
    return _importAppFile<Namespace>(target.startsWith("file:") ? target : resolve(target));
  };
}

/**
 * The names `use()` puts in scope for one module: each named export, and a default export that
 * is a named class or function under its own name.
 *
 * @internal
 */
export function _replExports(namespace: Namespace): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(namespace)) {
    if (name === "default") {
      const own = typeof value === "function" ? (value as { name?: string }).name : undefined;
      if (own && /^[A-Za-z_$][\w$]*$/.test(own) && !(own in namespace)) scope[own] = value;
      continue;
    }
    scope[name] = value;
  }
  return scope;
}

/**
 * The common facades, by the package each comes from.
 *
 * Each package is tried under its scoped name and then under the `zerotal` bundle's subpath, so an
 * app that declares either finds it. A package the app has not installed resolves under neither
 * name and puts nothing in scope.
 */
const FACADES: readonly { names: readonly string[]; from: readonly string[] }[] = [
  { names: ["Config"], from: ["@zerotal/core", "zerotal"] },
  { names: ["Storage"], from: ["@zerotal/core/storage", "zerotal/storage"] },
  { names: ["DB"], from: ["@zerotal/orm", "zerotal/orm"] },
  { names: ["Auth"], from: ["@zerotal/auth", "zerotal/auth"] },
  { names: ["Cache"], from: ["@zerotal/cache", "zerotal/cache"] },
  { names: ["Queue"], from: ["@zerotal/queue", "zerotal/queue"] },
  { names: ["Notify", "Notification"], from: ["@zerotal/notifications"] },
];

/**
 * The facades of the framework packages the app at `root` has installed, keyed by name.
 *
 * A package is looked up from the app's root, not from the framework's own location, so a facade
 * is in scope only when the app could import it itself.
 *
 * @internal
 */
export async function _replFacades(root: string): Promise<Record<string, unknown>> {
  const scope: Record<string, unknown> = {};
  for (const { names, from } of FACADES) {
    for (const specifier of from) {
      let path: string;
      try {
        path = Bun.resolveSync(specifier, root);
      } catch {
        continue; // Not installed under this name.
      }
      try {
        const namespace = (await import(path)) as Namespace;
        for (const name of names) if (namespace[name] !== undefined) scope[name] = namespace[name];
      } catch {
        /* installed but does not load here: leave it out rather than stop the REPL */
      }
      break;
    }
  }
  return scope;
}

/**
 * The classes exported from the app's models directory, keyed by class name.
 *
 * Booting has already imported every model through the conventions, so this reads modules
 * already loaded. Only classes are taken: a model file that also exports a constant, such as a
 * list of statuses, keeps it to itself until `use()` asks for it.
 *
 * @param root - The project root.
 * @param directory - The models directory, relative to `root` (`app.conventions.paths.models`).
 * @internal
 */
export async function _replModels(
  root: string,
  directory = "app/models",
): Promise<Record<string, unknown>> {
  const absolute = isAbsolute(directory) ? directory : join(root, directory);
  const scope: Record<string, unknown> = {};
  for (const file of await _scanAppFiles(absolute, "**/*.{ts,tsx}")) {
    if (file.endsWith(".d.ts") || /\.(?:test|spec)\.tsx?$/.test(file)) continue;
    try {
      // The same path the conventions imported it by, so this is the module already loaded.
      const namespace = await _importAppFile<Namespace>(`${absolute}/${file}`);
      for (const value of Object.values(namespace)) {
        if (typeof value !== "function") continue;
        const name = (value as { name?: string }).name;
        if (!name || !/^[A-Z]/.test(name)) continue;
        if (!/^class\b/.test(Function.prototype.toString.call(value))) continue;
        scope[name] = value;
      }
    } catch {
      /* a model that fails to import was already reported at boot */
    }
  }
  return scope;
}
