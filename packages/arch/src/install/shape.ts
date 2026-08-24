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
}

/** Read `root`'s shape. Every probe fails soft: an unknown fact is simply not stated. */
export async function detectShape(root: string): Promise<ProjectShape> {
  const [schemaSource, routeTypes, strict, hasTests] = await Promise.all([
    _schemaSource(root),
    _exists(join(root, "types", "routes.generated.ts")),
    _strictness(root),
    _hasFiles(join(root, "tests")),
  ]);
  return { schemaSource, routeTypes, strict, hasTests };
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
