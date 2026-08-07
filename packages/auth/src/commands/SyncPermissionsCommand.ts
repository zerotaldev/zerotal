import { Command } from "@zerotal/core";
import { Permission } from "../rbac/Permission.ts";
import { registeredPermissions } from "../rbac/PermissionRegistry.ts";

/**
 * `auth:sync-permissions` CLI command — upserts every code-declared permission
 * (registered with `definePermission(...)`, see {@link PermissionRegistry}) into
 * the `permissions` table. Idempotent — safe to run on every deploy. Pass
 * `--guard` to target a non-default guard.
 *
 * @example
 * ```ts
 * // bun zt auth:sync-permissions
 * // bun zt auth:sync-permissions --guard api
 * ```
 */
export class SyncPermissionsCommand extends Command {
  static commandName = "auth:sync-permissions";
  static description = "Create code-declared permissions that don't yet exist in the database";
  static needsApp = true;
  static args = [];
  static flags = [
    { name: "guard", type: "string" as const, description: "Guard name", default: "web" },
  ];

  async run(): Promise<void> {
    const guard = (this.flags["guard"] as string) || "web";
    const names = registeredPermissions();

    if (names.length === 0) {
      this.warn(
        "No permissions registered. Declare them with definePermission(...) in a provider.",
      );
      return;
    }

    let created = 0,
      existing = 0;
    for (const name of names) {
      const before = await Permission.query().where("name", name).where("guard", guard).first();
      await Permission.resolve(name, guard);
      if (before) {
        existing++;
      } else {
        created++;
        this.info(`  + ${name}`);
      }
    }

    this.line(
      `Synced ${names.length} permission(s) for guard "${guard}": ${created} created, ${existing} already present.`,
    );
  }
}
