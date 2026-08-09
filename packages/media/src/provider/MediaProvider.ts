import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { MediaManager } from "../MediaManager.ts";
import { BunImageDriver } from "../conversions/BunImageDriver.ts";
import { SharpImageDriver } from "../conversions/SharpImageDriver.ts";
import { setConversionDispatcher } from "../conversions/dispatch.ts";
import { mediaDefaults, type MediaConfigShape } from "../config.ts";
import { mediaSchemaConcern } from "../mediaSchemaConcern.ts";
import { setMediaState } from "../state.ts";
import { setPathGenerator } from "../MediaItem.ts";
import { DefaultPathGenerator } from "../paths/PathGenerator.ts";
import type { ImageDriver } from "../conversions/ImageDriver.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    media: MediaManager;
  }
}

/**
 * Registers the media system with the application.
 *
 * @example
 * // bootstrap/providers.ts
 * import { MediaProvider } from "@zerotal/media";
 *
 * export default [
 *   DatabaseProvider,
 *   StorageProvider, // media writes through disks — it needs this
 *   MediaProvider,
 * ];
 *
 * @example
 * // config/media.ts
 * import { MediaConfig } from "@zerotal/media";
 * export default MediaConfig({ disk: "s3", driver: "sharp" });
 */
export class MediaProvider extends ServiceProvider {
  static override provides = ["media"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "worker", "test", "repl"];

  override onRegister(): void {
    // Provision the media table on boot, after model discovery — no migration
    // required. Idempotent, and skipped when autoCreateTable is off.
    this.app.registerConcern?.(mediaSchemaConcern);

    this.app.container.singleton("media", () => {
      const config = this.resolveConfig();
      const driver = _buildDriver(config);

      setMediaState({ config, driver });
      setPathGenerator(new DefaultPathGenerator());

      return new MediaManager(config, driver);
    });
  }

  override async onBooted(): Promise<void> {
    // Pre-resolve so the MediaLibrary facade (makeSync) works after boot, and so the
    // shared state is installed before the first request rather than on it.
    const manager = (await this.app.container.make("media")) as MediaManager;

    this.installQueueDispatcher();
    await this.probeCodecs(manager);
    this.registerCommands();
  }

  override async onStopping(): Promise<void> {
    setConversionDispatcher(null);
  }

  /** Read `config/media.ts`, falling back to defaults field by field. */
  private resolveConfig(): MediaConfigShape {
    const config = this.app.container.tryMake("config") as ConfigManager | null;
    const declared = config?.get<Partial<MediaConfigShape>>("media") ?? {};
    return { ...mediaDefaults(), ...declared };
  }

  /**
   * Wire queued conversions, but only when a queue actually exists.
   *
   * This is what keeps `@zerotal/media` free of a dependency on
   * `@zerotal/queue`: the job class is imported lazily, inside the branch that
   * already knows the binding is there.
   */
  private installQueueDispatcher(): void {
    const queue = this.app.container.tryMake("queue");
    if (!queue) {
      setConversionDispatcher(null);
      return;
    }

    setConversionDispatcher(async (mediaId, conversions) => {
      const { dispatchConversionJob } = await import("../conversions/queueBridge.ts");
      await dispatchConversionJob(mediaId, conversions);
    });
  }

  /**
   * Check once, at boot, which encoders this host actually has.
   *
   * `Bun.Image` encodes AVIF and HEIC through OS codecs that are missing on most
   * Linux hosts. Without this the first sign of trouble is a queued job failing
   * days later; with it, the boot log names the problem while someone is still
   * looking at the deploy.
   */
  private async probeCodecs(manager: MediaManager): Promise<void> {
    if (!manager.config.allowHostFormats) return;

    const logger = this.app.container.tryMake("log") as
      { warn(message: string): void } | null | undefined;
    const missing: string[] = [];

    for (const format of ["avif", "heic"] as const) {
      if (!(await manager.driver.canEncode(format))) missing.push(format);
    }

    if (missing.length > 0) {
      logger?.warn(
        `[media] This host cannot encode ${missing.join(", ")} — conversions ` +
          `targeting them will fail. Use jpeg, png or webp, or install the OS codec.`,
      );
    }
  }

  private registerCommands(): void {
    const runner = this.app.container.tryMake("commands");
    if (!runner) return;

    runner.registerLazy("media:clean", () =>
      import("../commands/MediaCleanCommand.ts").then((m) => m.MediaCleanCommand),
    );
    runner.registerLazy("media:regenerate", () =>
      import("../commands/MediaRegenerateCommand.ts").then((m) => m.MediaRegenerateCommand),
    );
  }
}

/** Build the configured image driver. */
function _buildDriver(config: MediaConfigShape): ImageDriver {
  return config.driver === "sharp" ? new SharpImageDriver() : new BunImageDriver();
}
