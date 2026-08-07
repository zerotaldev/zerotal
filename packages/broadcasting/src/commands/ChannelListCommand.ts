import { Command } from "@zerotal/core";
import { Broadcast } from "../facades/Broadcast.ts";

export class ChannelListCommand extends Command {
  static override commandName = "channel:list";
  static override description = "List registered broadcast channel authorization rules";
  static override needsApp = true;

  async run(): Promise<void> {
    // Ensure routes/channels.ts has registered its rules.
    const channelsFile = `${process.cwd()}/routes/channels.ts`;
    if (await Bun.file(channelsFile).exists()) {
      try {
        await import(channelsFile);
      } catch (err) {
        this.warn(`Failed to load routes/channels.ts: ${(err as Error).message}`);
      }
    }

    const channels = Broadcast.channels();
    if (channels.length === 0) {
      this.info("No channel authorization rules registered. Define them in routes/channels.ts.");
      return;
    }

    this.section(`Broadcast channels (${channels.length})`);
    for (const ch of channels) {
      this.table([
        ["Pattern", ch.pattern],
        ["Params", ch.paramNames.length ? ch.paramNames.join(", ") : "(none)"],
      ]);
      this.newLine();
    }
  }
}
