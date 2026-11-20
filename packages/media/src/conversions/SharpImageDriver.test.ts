/**
 * How `SharpImageDriver` loads `sharp`, an optional peer, and what it says when it cannot.
 *
 * The image output is held by `driver-parity.test.ts`. This file is about the load: a missing
 * sharp must say so and name the install, an unreadable image must still come back as `null`,
 * and a sharp that is present but broken must not be reported as missing.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Application } from "@zerotal/core";
import { OptionalPeerMissingError } from "@zerotal/core/runtime";
import { SharpImageDriver } from "./SharpImageDriver.ts";
import { mediaDriverCheck } from "../doctor.ts";
import type { ImageDriver } from "./ImageDriver.ts";

async function run(args: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn([process.execPath, ...args], {
    ...(cwd === undefined ? {} : { cwd }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`bun ${args.join(" ")} exited ${code}: ${err}`);
  return out;
}

/**
 * Bundle the fixture and run it outside the repository, as a compiled app runs.
 *
 * `bun build` runs in a child: on Bun 1.3.14 for Windows a second `Bun.build()` in one process
 * fails to read files the first one read. `--no-install` stops Bun fetching a package it cannot
 * find from its global cache, which a compiled binary never does.
 */
async function bundleAndRun(external: string[]): Promise<Record<string, unknown>> {
  const outdir = mkdtempSync(join(tmpdir(), "zerotal-media-sharp-bundle-"));
  try {
    await run([
      "build",
      `${import.meta.dir}/../__fixtures__/sharp-bundled.ts`,
      "--target=bun",
      `--outfile=${join(outdir, "app.js")}`,
      ...external.map((name) => `--external=${name}`),
    ]);
    const out = await run(["--no-install", join(outdir, "app.js")], outdir);
    return JSON.parse(out.trim().split("\n").at(-1)!) as Record<string, unknown>;
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
}

describe("loading sharp", () => {
  it("still answers null for bytes that are not an image", async () => {
    const driver = new SharpImageDriver();
    expect(await driver.metadata(new TextEncoder().encode("not an image"))).toBeNull();
    expect(await driver.placeholder(new TextEncoder().encode("not an image"))).toBeNull();
  });

  it("names the install when an app was built without sharp", async () => {
    expect(await bundleAndRun(["sharp"])).toMatchObject({
      threw: "OptionalPeerMissingError",
      code: "E_OPTIONAL_PEER_MISSING",
      install: "bun add sharp",
    });
  }, 60_000);

  it("reports sharp's own failure, not a missing package, when its native binary is absent", async () => {
    // A bundle (and `bun zt compile`) carries sharp's JavaScript but not the platform binary
    // sharp looks up at run time, so sharp itself fails to start. That is not "install sharp".
    const result = await bundleAndRun([]);
    expect(result["threw"]).not.toBe("OptionalPeerMissingError");
    expect(String(result["message"])).toContain("sharp");
  }, 60_000);
});

describe("the media-image-driver doctor check", () => {
  function appWith(driverName: "bun" | "sharp" | null, driver?: Partial<ImageDriver>): Application {
    const media =
      driverName === null ? undefined : { config: { driver: driverName }, driver: driver ?? {} };
    return { container: { tryMake: () => media } } as unknown as Application;
  }

  const missing = (): Promise<boolean> => {
    throw new OptionalPeerMissingError({
      peer: "sharp",
      feature: 'config/media.ts driver: "sharp"',
      install: "bun add sharp",
    });
  };

  it("passes on the built-in driver without looking for sharp", async () => {
    expect((await mediaDriverCheck.run(appWith("bun", { canEncode: missing }))).status).toBe("ok");
    expect((await mediaDriverCheck.run(appWith(null))).status).toBe("ok");
  });

  it("passes when sharp is selected and loads", async () => {
    const result = await mediaDriverCheck.run(appWith("sharp", new SharpImageDriver()));
    expect(result.status).toBe("ok");
  });

  it("fails, with the install command, when sharp is selected and missing", async () => {
    const result = await mediaDriverCheck.run(appWith("sharp", { canEncode: missing }));
    expect(result.status).toBe("fail");
    expect(result.fix).toContain("bun add sharp");
  });

  it("reports a sharp that is installed but broken as broken", async () => {
    const broken = (): Promise<boolean> => {
      throw new Error('Could not load the "sharp" module using the linux-x64 runtime');
    };
    const result = await mediaDriverCheck.run(appWith("sharp", { canEncode: broken }));
    expect(result.status).toBe("fail");
    expect(result.message).toContain("did not load");
  });
});
