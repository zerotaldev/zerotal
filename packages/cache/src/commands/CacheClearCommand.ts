import type { Application } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { CacheManager } from "../CacheManager.ts";

export class CacheClearCommand extends Command {
  static commandName = "cache:clear";
  static description = "Clear all cached values";
  static needsApp = true;

  static flags = [
    {
      name: "driver",
      type: "string" as const,
      description: "Clear a specific driver (sqlite | redis | memory)",
    },
  ];

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    if (!app) {
      this.error("Application not available.");
      return;
    }

    const cache = app.container.makeSync("cache") as CacheManager;
    await cache.flush();
    this.info("Cache cleared.");
  }
}
