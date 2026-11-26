import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { _installSettingsAdmin } from "../admin.ts";
import { SettingsManager } from "../SettingsManager.ts";
import { settingsSchemaConcern } from "../settingsSchemaConcern.ts";
import { DatabaseStore } from "../stores/DatabaseStore.ts";
import "../facades/Settings.ts";

/**
 * SettingsProvider — binds `settings`, creates its table on boot, and puts a
 * settings screen in the admin panel when there is one.
 *
 * @example
 * // bootstrap/providers.ts
 * import { SettingsProvider } from "@zerotal/settings";
 *
 * export default [
 *   DatabaseProvider,
 *   TenancyProvider,
 *   AuditProvider, // optional: every change is recorded when it is registered
 *   SettingsProvider,
 * ];
 */
export class SettingsProvider extends ServiceProvider {
  static override provides = ["settings"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "worker", "test", "repl"];

  override onRegister(): void {
    // No migration to write: the table is created on boot when it is missing.
    this.app.registerConcern?.(settingsSchemaConcern);

    this.app.container.singleton("settings", () => {
      const config = this.app.container.makeSync("config") as ConfigManager;
      const table = config.get<string>("settings.table", "zerotal_settings");
      const audit = config.get<boolean>("settings.audit", true);
      return new SettingsManager(new DatabaseStore(table), { audit });
    });
  }

  override async onBooting(): Promise<void> {
    // The panel mounts its routes once booting finishes, so the screen is
    // contributed here rather than in onBooted, which would race the mount.
    _installSettingsAdmin(this.app);
  }
}
