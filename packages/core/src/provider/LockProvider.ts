import { ServiceProvider } from "./ServiceProvider.ts";
import type { AppEnvironment } from "./ServiceProvider.ts";
import type { ConfigManager } from "../config/ConfigManager.ts";
import { LockManager } from "../lock/LockManager.ts";
import { LockConfig } from "../lock/config.ts";
import type { LockConfigShape } from "../lock/config.ts";
import { MemoryLockDriver } from "../lock/drivers/MemoryLockDriver.ts";
import { SqliteLockDriver } from "../lock/drivers/SqliteLockDriver.ts";
import { RedisLockDriver } from "../lock/drivers/RedisLockDriver.ts";
import type { LockDriver } from "../lock/drivers/LockDriver.ts";

// The `lock` binding is registered directly on core's ContainerBindings
// (see src/container/types.ts) since lock ships as part of core.

/**
 * Service provider that registers the `lock` binding.
 *
 * Reads the `lock` config, instantiates the matching {@link LockDriver}
 * ({@link MemoryLockDriver}, {@link SqliteLockDriver}, or
 * {@link RedisLockDriver}), and binds a {@link LockManager} singleton. Pre-
 * resolves it on boot so the synchronous {@link Lock} facade works afterward,
 * and disposes the manager (closing driver resources) on stop.
 *
 * @category Configuration
 */
export class LockProvider extends ServiceProvider {
  static override provides = ["lock"] as const;
  static override environments: AppEnvironment[] = ["web", "worker", "console", "test"];

  override onRegister(): void {
    this.app.container.singleton("lock", () => {
      const configManager = this.app.container.tryMake("config") as ConfigManager | null;
      const raw = configManager?.get<Partial<LockConfigShape>>("lock") ?? {};
      const cfg = LockConfig(raw);

      let driver: LockDriver;

      switch (cfg.driver) {
        case "redis":
          driver = new RedisLockDriver(cfg.prefix);
          break;
        case "sqlite":
          driver = new SqliteLockDriver(cfg.sqlite.path);
          break;
        case "memory":
        default:
          driver = new MemoryLockDriver();
          break;
      }

      return new LockManager(driver);
    });
  }

  override async onBooted(): Promise<void> {
    // Pre-resolve so the Lock facade (synchronous callers) works after boot.
    await this.app.container.make("lock");
  }

  override async onStopping(): Promise<void> {
    const manager = this.app.container.tryMake("lock") as LockManager | null;
    manager?.dispose();
  }
}
