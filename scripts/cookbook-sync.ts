#!/usr/bin/env bun
/**
 * The cookbook sync contract — the domain layer, held identical across builds.
 *
 * Tracker is built three times (`view`, `flow`, `inertia`) so that a difference
 * in behaviour between them *is* a framework bug. That inference only holds if
 * everything below the transport is provably the same. This script is what makes
 * "provably" true: it compares the contract files byte for byte and fails when
 * they drift.
 *
 * **Why sync and not a shared package.** A private `@tracker/domain` would be
 * tidier and would defeat the purpose — someone opening `apps/tracker-flow`
 * should see the app a real person would write, imports and all. Duplication is
 * the point; this check is what makes duplication safe.
 *
 * The first app in `APPS` that exists on disk is the reference. `view` is listed
 * first because the plan builds it first and matches the others to it.
 *
 *   bun scripts/cookbook-sync.ts            # report drift
 *   bun scripts/cookbook-sync.ts --check    # exit 1 on drift (CI)
 *   bun scripts/cookbook-sync.ts --fix      # copy the reference over the others
 */
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

/** In build order. The first one present on disk is the reference. */
const APPS = ["tracker-view", "tracker-flow", "tracker-inertia"] as const;

/**
 * Directories and files held identical.
 *
 * Deliberately not `config/**`: `config/inertia.ts` and `config/broadcasting.ts`
 * are render-specific and exist in only one build. Config is where the three
 * apps are *supposed* to differ, so putting it in the contract would mean a
 * permanent, expected failure — and a check that is expected to fail is a check
 * nobody reads.
 *
 * `resources/lang/**` is in: a translated string is domain copy, and three
 * builds disagreeing about what a flash message says is exactly the class of
 * divergence this exists to catch.
 */
const CONTRACT = [
  "app/models",
  "app/policies",
  "app/requests",
  "app/events",
  "app/notifications",
  "app/support",
  "app/channels.ts",
  "database/migrations",
  "database/seeders",
  "resources/lang",
  "tests/behaviour",
  "tests/domain",
];

const ROOT = join(import.meta.dir, "..");
const APPS_DIR = join(ROOT, "apps");

interface Drift {
  path: string;
  app: string;
  kind: "missing" | "differs" | "extra";
}

/** Every file under a contract entry, relative to the app root. Missing is empty. */
async function filesUnder(appDir: string, entry: string): Promise<string[]> {
  const target = join(appDir, entry);
  const file = Bun.file(target);

  // A contract entry can name a single file (`app/channels.ts`) or a directory.
  if (await file.exists()) return [entry];

  try {
    const found = await readdir(target, { recursive: true, withFileTypes: true });
    return found
      .filter((d) => d.isFile())
      .map((d) => relative(appDir, join(d.parentPath ?? d.path, d.name)).replace(/\\/g, "/"));
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const fix = process.argv.includes("--fix");

  const present: string[] = [];
  for (const app of APPS) {
    if (await Bun.file(join(APPS_DIR, app, "package.json")).exists()) present.push(app);
  }

  if (present.length === 0) {
    console.log("cookbook-sync: no tracker apps found — nothing to compare.");
    return;
  }

  const [reference, ...others] = present as [string, ...string[]];

  if (others.length === 0) {
    // Not a pass and not a failure: there is nothing to disagree with yet. Said
    // plainly so a green CI line is not mistaken for "the contract is enforced".
    console.log(
      `cookbook-sync: only ${reference} exists. The contract is not enforced until a second build lands.`,
    );
    return;
  }

  const refDir = join(APPS_DIR, reference);
  const drifts: Drift[] = [];

  for (const entry of CONTRACT) {
    const refFiles = await filesUnder(refDir, entry);

    for (const app of others) {
      const appDir = join(APPS_DIR, app);
      const appFiles = new Set(await filesUnder(appDir, entry));

      for (const rel of refFiles) {
        const refText = await Bun.file(join(refDir, rel)).text();
        const target = Bun.file(join(appDir, rel));

        if (!(await target.exists())) {
          drifts.push({ path: rel, app, kind: "missing" });
          if (fix) await Bun.write(join(appDir, rel), refText);
          continue;
        }

        appFiles.delete(rel);
        if ((await target.text()) !== refText) {
          drifts.push({ path: rel, app, kind: "differs" });
          if (fix) await Bun.write(join(appDir, rel), refText);
        }
      }

      // Anything left is in the other app and not in the reference. Reported,
      // never deleted — `--fix` copies the reference forward, it does not prune.
      for (const rel of appFiles) drifts.push({ path: rel, app, kind: "extra" });
    }
  }

  const files = new Set(drifts.map((d) => d.path)).size;
  console.log(
    `cookbook-sync: reference ${reference}, compared against ${others.join(", ")} ` +
      `— ${drifts.length === 0 ? "in sync" : `${drifts.length} difference(s) across ${files} file(s)`}`,
  );

  if (drifts.length === 0) return;

  for (const { app, path, kind } of drifts.sort((a, b) => a.path.localeCompare(b.path))) {
    console.log(`  ${kind.padEnd(8)} ${app.padEnd(16)} ${path}`);
  }

  if (fix) {
    console.log("\nCopied the reference over every 'missing' and 'differs' file.");
    return;
  }

  if (check) {
    console.log(
      "\nThe domain layer must be identical across builds — that is what makes a behavioural " +
        "difference diagnostic. Run with --fix, or reconcile by hand.",
    );
    process.exit(1);
  }
}

await main();
