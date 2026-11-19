/**
 * `zt doctor` checks this package contributes.
 */
import type { DoctorCheck } from "@zerotal/core";
import { OptionalPeerMissingError } from "@zerotal/core/runtime";
import type { MediaManager } from "./MediaManager.ts";

/**
 * `driver: "sharp"` needs the `sharp` package, an optional peer. An app that selects the driver
 * without installing it boots, and fails on its first conversion. This loads sharp the way the
 * driver does, by asking it to encode a PNG, and says which it is before that conversion.
 */
export const mediaDriverCheck: DoctorCheck = {
  id: "media-image-driver",
  label: "Media image driver",
  async run(app) {
    const media = app.container.tryMake("media") as MediaManager | undefined;
    if (!media) return { status: "ok", message: "Media is not registered." };
    if (media.config.driver !== "sharp") {
      return { status: "ok", message: 'driver "bun" is built in.' };
    }

    try {
      await media.driver.canEncode("png");
      return { status: "ok", message: 'driver "sharp", and sharp is installed.' };
    } catch (error) {
      if (error instanceof OptionalPeerMissingError) {
        return {
          status: "fail",
          message:
            'config/media.ts sets driver: "sharp", but sharp is not installed, so every ' +
            "conversion fails.",
          fix: `${error.missing.install}, or set driver: "bun" in config/media.ts`,
        };
      }
      // Installed but not loadable: most often sharp's native binary for this platform.
      return {
        status: "fail",
        message: `sharp is installed but did not load: ${error instanceof Error ? error.message : String(error)}`,
        fix: "Reinstall dependencies on this platform: rm -rf node_modules && bun install",
      };
    }
  },
};
