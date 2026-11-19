import { describe, it, expect } from "bun:test";
import { OptionalPeerMissingError } from "@zerotal/core/runtime";
import { MediaProvider } from "./MediaProvider.ts";
import { MediaManager } from "../MediaManager.ts";
import { BunImageDriver } from "../conversions/BunImageDriver.ts";
import { mediaDefaults } from "../config.ts";
import type { ConversionFormat } from "../types.ts";

// The boot-time codec probe, driven directly: a whole app is not needed to see what it logs,
// and the cases here (a driver that cannot load) are hard to stage in a real one.
function probe(canEncode: (format: ConversionFormat) => Promise<boolean>): {
  run(): Promise<void>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const logger = { warn: (message: string) => warnings.push(message) };
  const provider = Object.create(MediaProvider.prototype) as {
    app: unknown;
    probeCodecs(manager: MediaManager): Promise<void>;
  };
  provider.app = { container: { tryMake: (key: string) => (key === "log" ? logger : null) } };

  const driver = Object.assign(new BunImageDriver(), { canEncode });
  const manager = new MediaManager(
    { ...mediaDefaults(), driver: "sharp", allowHostFormats: true },
    driver,
  );
  return { run: () => provider.probeCodecs(manager), warnings };
}

describe("the boot-time codec probe", () => {
  it("logs a missing sharp and lets the app boot", async () => {
    const { run, warnings } = probe(async () => {
      throw new OptionalPeerMissingError({
        peer: "sharp",
        feature: 'config/media.ts driver: "sharp"',
        install: "bun add sharp",
      });
    });

    await run();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("bun add sharp");
  });

  it("logs a sharp that is installed but does not load, and lets the app boot", async () => {
    // What sharp throws when node_modules came from another platform, or in a compiled
    // binary. `zt doctor` boots the app before it can report this, so boot must survive it.
    const { run, warnings } = probe(async () => {
      throw new Error('Could not load the "sharp" module using the linux-x64 runtime');
    });

    await run();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Could not load the "sharp" module using the linux-x64 runtime');
    expect(warnings[0]).toContain("zt doctor");
  });

  it("names the formats this host cannot encode", async () => {
    const { run, warnings } = probe(async (format) => format !== "heic");

    await run();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("cannot encode heic");
  });
});
