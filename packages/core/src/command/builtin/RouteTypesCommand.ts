import { Command } from "../Command.ts";
import type { FlagDef } from "../Command.ts";
import { Router } from "../../router/Router.ts";
import { writeRouteTypes, ROUTE_TYPES_FILE } from "../../router/routeTypes.ts";

/**
 * `bun zt route:types` — write `types/routes.generated.ts`, the name → pattern
 * map that makes `route()` type-checked.
 *
 * Boots the application (`needsApp`) and reads `Router.namedRoutes`, so routes
 * a provider registers programmatically and names set via a route file's
 * `export const meta` are included — not just what the file-router's naming
 * convention would produce.
 *
 * Commit the generated file: editors and CI need it without booting the app.
 * `zt dev` refreshes it on every restart, and `--check` fails when the file on
 * disk no longer matches the routes, which is the CI gate that keeps it honest.
 *
 * @category Diagnostics
 */
export class RouteTypesCommand extends Command {
  static commandName = "route:types";
  static description = "Generate types/routes.generated.ts for typed route() names";
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
    const result = await writeRouteTypes(Router.namedRoutes, { check });

    if (check) {
      if (result.changed) {
        this.error(`${result.path} is out of date. Run: bun zt route:types`);
        throw new Error("Route types are out of date.");
      }
      this.info(`${result.path} is up to date (${result.count} named routes).`);
      return;
    }

    if (result.count === 0) {
      this.warn("No named routes found — the generated map is empty.");
    }

    this.info(
      `${result.changed ? "Wrote" : "Unchanged"}: ${ROUTE_TYPES_FILE} (${result.count} named routes)`,
    );
  }
}
