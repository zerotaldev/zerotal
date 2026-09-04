import { Command } from "../Command.ts";
import type { FlagDef } from "../Command.ts";
import { Router } from "../../router/Router.ts";
import { writeRouteTypes, ROUTE_TYPES_FILE } from "../../router/routeTypes.ts";
import { _runTypeGenerators } from "../TypeGenerators.ts";

/**
 * `bun zt route:types` — refresh every type file the app generates from its own
 * filesystem: `types/routes.generated.ts`, the name → pattern map that makes
 * `route()` type-checked, plus whatever the installed view packages register
 * (`@zerotal/inertia` adds its page registry, which types `Inertia.render`).
 *
 * It generates more than routes because a developer who adds a page and gets a
 * type error about its name reaches for the command whose name says it
 * generates types — and used to get the same error back, having regenerated the
 * wrong half. Both files answer "what does the tree contain, as types?", and
 * both go stale on the same edits.
 *
 * Boots the application (`needsApp`) and reads `Router.namedRoutes`, so routes
 * a provider registers programmatically and names set via a route file's
 * `export const meta` are included — not just what the file-router's naming
 * convention would produce.
 *
 * Commit the generated files: editors and CI need them without booting the app.
 * `zt dev` refreshes them on every restart, and `--check` fails when a file on
 * disk no longer matches, which is the CI gate that keeps them honest.
 *
 * @category Diagnostics
 */
export class RouteTypesCommand extends Command {
  static commandName = "route:types";
  static description = "Generate the app's type files (routes, and any view package's registry)";
  static needsApp = true;
  static args = [];
  static flags: FlagDef[] = [
    {
      name: "check",
      type: "boolean",
      description: "Fail instead of writing when the generated file is out of date (for CI)",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const check = this.flags["check"] as boolean;

    const routes = await writeRouteTypes(Router.namedRoutes, { check });

    // The routes file, then whatever the installed view packages register — the
    // Inertia page registry, today. Collected into one list so the command reports
    // every generated file the same way, and so a failure in one does not cost
    // you the other: half-regenerated types are how this got confusing to begin with.
    const files: { file: string; summary: string; changed: boolean }[] = [
      {
        file: ROUTE_TYPES_FILE,
        summary: `${routes.count} named routes`,
        changed: routes.changed,
      },
    ];
    let failed = false;

    for (const { name, result, error } of await _runTypeGenerators({ check })) {
      if (error) {
        failed = true;
        this.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (result) files.push(result);
    }

    if (check) {
      const stale = files.filter((f) => f.changed);
      for (const f of files) {
        if (f.changed) this.error(`${f.file} is out of date. Run: bun zt route:types`);
        else this.info(`${f.file} is up to date (${f.summary}).`);
      }
      if (stale.length > 0) {
        throw new Error(`Generated types are out of date: ${stale.map((f) => f.file).join(", ")}`);
      }
      if (failed) throw new Error("A type generator failed.");
      return;
    }

    if (routes.count === 0) {
      this.warn("No named routes found — the generated map is empty.");
    }

    for (const f of files) {
      this.info(`${f.changed ? "Wrote" : "Unchanged"}: ${f.file} (${f.summary})`);
    }

    if (failed) throw new Error("A type generator failed.");
  }
}
