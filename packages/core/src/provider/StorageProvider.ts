import { ServiceProvider } from "./ServiceProvider.ts";
import type { AppEnvironment } from "./ServiceProvider.ts";
import type { ConfigManager } from "../config/ConfigManager.ts";
import { StorageManager } from "../storage/StorageManager.ts";
import { StorageConfig } from "../storage/config.ts";
import { StorageFilesMiddleware, mountsFrom } from "../storage/StorageFilesMiddleware.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    storage: StorageManager;
  }
}

/**
 * Registers the `storage` binding and, for any disk that declares `serve`, the
 * middleware that exposes it over HTTP.
 *
 * A disk without a `serve` block has no URL at all — the default `local` disk
 * is unreachable and only `public` is served. Exposure is opt-in per disk
 * rather than something you have to remember to switch off.
 */
export class StorageProvider extends ServiceProvider {
  static override provides = ["storage"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "worker", "test"];

  override onRegister(): void {
    this.app.container.singleton("storage", () => {
      const config = this.app.container.makeSync("config") as ConfigManager;
      const storageCfg = config.get<ReturnType<typeof StorageConfig>>("storage", StorageConfig());
      return new StorageManager(storageCfg);
    });
  }

  override async onBooting(): Promise<void> {
    const storage = await this.app.container.make("storage");

    const config = this.app.container.makeSync("config") as ConfigManager;
    const storageCfg = config.get<ReturnType<typeof StorageConfig>>("storage", StorageConfig());
    const mounts = mountsFrom(storageCfg);
    // No servable disk means no middleware — nothing to match, nothing to get wrong.
    if (mounts.length === 0) return;

    this.app.useOnce(StorageFilesMiddleware.with({ mounts, storage }));
  }
}
