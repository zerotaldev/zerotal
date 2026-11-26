/**
 * What this project is configured to be, as distinct from what it has installed.
 *
 * The guidance in `guidelines.ts` was a function of the package list alone, and
 * a package list cannot answer the questions that actually decide what an agent
 * should write. The framework's contracts are not uniform: the same mixin needs a
 * migration in one app and not in another, `route()` is checked against generated
 * names in one and unchecked in another, and an optional property is written one
 * way under `exactOptionalPropertyTypes` and another way without it.
 *
 * An agent that guesses wrong there does not get a type error. It gets a working
 * build and a runtime failure — `no such column: email_verified_at`, hundreds of
 * tests down at once, in an app whose schema is owned by migrations and whose
 * `AGENTS.md` never said so.
 *
 * ## Read from files, not from a booted app
 *
 * `arch:install` runs in a project that may not boot — that is often *why*
 * someone is installing the agent surface. Everything here comes off disk.
 *
 * ## What is deliberately not read
 *
 * `.env`, and anything else holding credentials. This output is written into a
 * file that is committed and pasted into prompts; a detector that reads secrets
 * is one refactor away from emitting them. Where a fact is available from both a
 * config file and the environment, the config file is the only source used.
 */
import { join } from "node:path";

/** How the database schema comes to exist, which decides who must write a column. */
export type SchemaSource = "migrations" | "models" | "both" | "unknown";

export interface ProjectShape {
  schemaSource: SchemaSource;
  /** `types/routes.generated.ts` exists, so `route()` names are checked. */
  routeTypes: boolean;
  /** tsconfig flags that change how correct code is written, not just how it is checked. */
  strict: {
    exactOptionalPropertyTypes: boolean;
    noUncheckedIndexedAccess: boolean;
    strict: boolean;
  };
  /** A `tests/` directory with something in it. */
  hasTests: boolean;
  /**
   * Where requests are routed from, by which directories hold files. A starter
   * routes by file under `app/routes/`, the API template registers controllers in
   * `routes/`, and the Flow starter does both; guidance that names the wrong one
   * sends an agent to write a file nothing reads.
   */
  routing: {
    /** `app/routes/`: file-based routes. */
    files: boolean;
    /** `routes/`: routes registered in code. */
    registered: boolean;
    /** `app/controllers/`. */
    controllers: boolean;
  };
  /**
   * The provider class names the files under `bootstrap/` mention, or `undefined`
   * when there are none to read. A package can be installed through the bundle
   * and still do nothing until its provider is registered, which is the
   * difference between "dispatch a job" and "register `QueueProvider`, then
   * dispatch a job".
   */
  providers: string[] | undefined;
  /**
   * The manifest declares the `zerotal` bundle, so the packages it re-exports are
   * imported as `zerotal/orm` and the rest, not by their scoped names.
   */
  bundle: boolean;
}

/** Read `root`'s shape. Every probe fails soft: an unknown fact is simply not stated. */
export async function detectShape(root: string): Promise<ProjectShape> {
  const [
    schemaSource,
    routeTypes,
    strict,
    hasTests,
    files,
    registered,
    controllers,
    providers,
    bundle,
  ] = await Promise.all([
    _schemaSource(root),
    _exists(join(root, "types", "routes.generated.ts")),
    _strictness(root),
    _hasFiles(join(root, "tests")),
    _hasFiles(join(root, "app", "routes")),
    _hasFiles(join(root, "routes")),
    _hasFiles(join(root, "app", "controllers")),
    _providers(root),
    _declaresBundle(root),
  ]);
  return {
    schemaSource,
    routeTypes,
    strict,
    hasTests,
    routing: { files, registered, controllers },
    providers,
    bundle,
  };
}

/** Whether `package.json` lists `zerotal` among its dependencies. */
async function _declaresBundle(root: string): Promise<boolean> {
  const source = await _read(join(root, "package.json"));
  if (!source) return false;
  try {
    const manifest = JSON.parse(source) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return (
      "zerotal" in (manifest.dependencies ?? {}) || "zerotal" in (manifest.devDependencies ?? {})
    );
  } catch {
    return false;
  }
}

/**
 * Provider names in the files under `bootstrap/`, read as text.
 *
 * Every file there, not only `providers.ts`: the starters keep the list in that
 * file, the API template passes it straight to the app in `app.ts`. A name in a
 * comment counts too. That errs toward saying a provider is registered, which
 * costs one sentence of setup advice the app did not need, rather than toward
 * telling an agent to register one twice.
 *
 * `undefined` when there is no `bootstrap/` to read, so the guidance hedges
 * rather than saying a provider is missing from a file that does not exist.
 */
async function _providers(root: string): Promise<string[] | undefined> {
  let names: string[];
  try {
    const { readdir } = await import("node:fs/promises");
    names = (await readdir(join(root, "bootstrap"))).filter((name) => /\.[cm]?[jt]sx?$/.test(name));
  } catch {
    return undefined;
  }
  if (names.length === 0) return undefined;
  const found = new Set<string>();
  for (const name of names) {
    const source = await _read(join(root, "bootstrap", name));
    for (const match of source?.match(/\b[A-Z]\w*Provider\b/g) ?? []) found.add(match);
  }
  return [...found].sort();
}

/**
 * Migrations, models, or both.
 *
 * Mirrors `zt doctor`'s `synchronize-vs-migrations` check, which decides the same
 * question from the same two inputs — but reports it as a *problem* when both are
 * on. Here both is a legitimate answer worth stating plainly, because an agent
 * needs to know it is looking at an app where either route might be the intended
 * one and it should ask rather than assume.
 */
async function _schemaSource(root: string): Promise<SchemaSource> {
  const migrations = await _hasFiles(join(root, "database", "migrations"));
  const synchronize = await _synchronizeOn(root);

  if (migrations && synchronize) return "both";
  if (migrations) return "migrations";
  if (synchronize) return "models";
  return "unknown";
}

/**
 * Whether `database.synchronize` is on.
 *
 * Read as text rather than by importing the config, which would need the app's
 * environment and its whole provider graph. The value is commonly an expression —
 * `env("APP_ENV") !== "production"` — so a literal `false` is the only confident
 * "off"; anything else is treated as "may be on", which errs toward telling the
 * agent the arrangement is ambiguous rather than asserting the wrong half.
 */
async function _synchronizeOn(root: string): Promise<boolean> {
  const source = await _read(join(root, "config", "database.ts"));
  if (!source) return false;
  const match = /\bsynchronize\s*:\s*([^,\n}]+)/.exec(source);
  if (!match) return false;
  const value = (match[1] ?? "").trim();
  return value !== "false";
}

/**
 * Read the strictness flags through the whole `extends` chain.
 *
 * Reading only the project's own `tsconfig.json` gets this wrong for most real
 * apps, and wrong in the quiet direction: a workspace app that extends a strict
 * base has none of these flags in its own file, so every one reads as off and the
 * guidance says nothing. The app the framework itself ships did exactly that —
 * detected as unstrict while compiling under a base that turns all three on.
 *
 * Nearest wins, as tsc resolves it: a flag set in the extending file overrides
 * the one it inherits, including turning an inherited flag off.
 */
async function _strictness(root: string): Promise<ProjectShape["strict"]> {
  const chain = await _tsconfigChain(join(root, "tsconfig.json"));

  const on = (flag: string): boolean => {
    for (const source of chain) {
      const match = new RegExp(`"${flag}"\\s*:\\s*(true|false)`).exec(source);
      if (match) return match[1] === "true";
    }
    return false;
  };

  // The two that matter here are not implied by `strict` — each has to be asked
  // for, which is why they are worth reporting separately from it.
  return {
    strict: on("strict"),
    exactOptionalPropertyTypes: on("exactOptionalPropertyTypes"),
    noUncheckedIndexedAccess: on("noUncheckedIndexedAccess"),
  };
}

/** A tsconfig and everything it extends, nearest first. */
async function _tsconfigChain(path: string, depth = 0): Promise<string[]> {
  // Bounded rather than cycle-tracked: a chain this long is already pathological,
  // and the cost of being wrong here is a missing line of guidance.
  if (depth > 8) return [];

  const source = await _read(path);
  if (source === undefined) return [];

  const extended = /"extends"\s*:\s*"([^"]+)"/.exec(source)?.[1];
  if (!extended) return [source];

  // Only a relative path is resolvable from here. A package reference
  // (`@tsconfig/bun`) lives in node_modules under a layout this does not chase.
  if (!extended.startsWith(".")) return [source];

  const { dirname, resolve: resolvePath } = await import("node:path");
  const next = resolvePath(
    dirname(path),
    extended.endsWith(".json") ? extended : `${extended}.json`,
  );
  return [source, ...(await _tsconfigChain(next, depth + 1))];
}

async function _read(path: string): Promise<string | undefined> {
  try {
    const file = Bun.file(path);
    return (await file.exists()) ? await file.text() : undefined;
  } catch {
    return undefined;
  }
}

async function _exists(path: string): Promise<boolean> {
  try {
    return await Bun.file(path).exists();
  } catch {
    return false;
  }
}

/** A directory that exists and holds at least one file. */
async function _hasFiles(dir: string): Promise<boolean> {
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir);
    return entries.some((entry) => !entry.startsWith("."));
  } catch {
    return false;
  }
}
