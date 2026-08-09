import { Command } from "@zerotal/core";
import type { FlagDef } from "@zerotal/core";
import { MediaItem } from "../MediaItem.ts";
import { MediaLibrary } from "../facades/MediaLibrary.ts";
import { ownerClassFor } from "../conversions/queueBridge.ts";
import { hasCollection } from "../collections/resolve.ts";

/**
 * Rebuild conversions for existing media — the command you run after widening a
 * thumbnail or adding a conversion to a collection that already has files in it.
 *
 * @example
 * ```bash
 * bun zt media:regenerate                          # everything
 * bun zt media:regenerate --model=Product          # one model
 * bun zt media:regenerate --only=thumb,hero        # named conversions
 * bun zt media:regenerate --id=42                  # one item
 * ```
 */
export class MediaRegenerateCommand extends Command {
  static override commandName = "media:regenerate";
  static override description = "Regenerate conversions for existing media";
  static override needsApp = true;
  static override flags: FlagDef[] = [
    { name: "model", type: "string", description: "Only media owned by this model type" },
    { name: "id", type: "string", description: "Only this media id" },
    { name: "only", type: "string", description: "Comma-separated conversion names" },
  ];

  async run(): Promise<void> {
    const only = this.parseOnly();
    const media = await this.select();

    if (media.length === 0) {
      this.warn("No media matched.");
      return;
    }

    let regenerated = 0;
    let skipped = 0;

    for (const item of media) {
      const ownerClass = ownerClassFor(item.modelType);

      // A model_type that no longer resolves is not a failure worth stopping
      // for: a renamed or deleted model leaves rows behind, and the run should
      // still process everything else.
      if (ownerClass === null || !hasCollection(ownerClass, item.collectionName)) {
        skipped++;
        continue;
      }

      const generated = await MediaLibrary.regenerate(item, ownerClass, only);
      if (generated.length > 0) regenerated++;
    }

    this.info(`Regenerated conversions for ${regenerated} of ${media.length} item(s).`);
    if (skipped > 0) {
      this.warn(
        `${skipped} skipped — their model type or collection is no longer declared. ` +
          "Run `bun zt media:clean` to review them.",
      );
    }
  }

  private parseOnly(): string[] | undefined {
    const raw = this.flags["only"];
    if (typeof raw !== "string" || raw.trim() === "") return undefined;
    return raw
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
  }

  private async select(): Promise<MediaItem[]> {
    const id = this.flags["id"];
    if (typeof id === "string" && id.trim() !== "") {
      const one = await MediaItem.find(id.trim());
      return one === null ? [] : [one];
    }

    const model = this.flags["model"];
    if (typeof model === "string" && model.trim() !== "") {
      return MediaItem.query().where("model_type", model.trim()).get();
    }

    return MediaItem.query().get();
  }
}
