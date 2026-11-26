import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZEROTAL_VERSION } from "../../support/version.ts";
import { _aboutReport, _formatAbout, _installedPackages } from "./AboutCommand.ts";

let dir: string;

function pkg(path: string, manifest: Record<string, unknown>): void {
  mkdirSync(join(dir, path), { recursive: true });
  writeFileSync(join(dir, path, "package.json"), JSON.stringify(manifest));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zt-about-"));
  pkg(".", {
    name: "shop",
    version: "0.0.1",
    dependencies: { zerotal: ZEROTAL_VERSION, "@zerotal/notifications": ZEROTAL_VERSION },
  });
  pkg("node_modules/zerotal", {
    name: "zerotal",
    version: ZEROTAL_VERSION,
    dependencies: { "@zerotal/core": "workspace:*", "@zerotal/orm": "workspace:*" },
  });
  pkg("node_modules/@zerotal/core", { name: "@zerotal/core", version: ZEROTAL_VERSION });
  pkg("node_modules/@zerotal/notifications", {
    name: "@zerotal/notifications",
    version: ZEROTAL_VERSION,
  });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const CAPABILITIES = [
  { need: "Multi-tenancy", pkg: "@zerotal/tenancy", doc: "tenancy" },
  { need: "Tenant-aware queues", pkg: "@zerotal/tenancy", doc: "tenancy" },
  { need: "Email and Slack", pkg: "@zerotal/notifications", doc: "notifications" },
  { need: "Routing", doc: "routing" },
];

describe("_installedPackages", () => {
  it("lists what is on disk, and the bundle's packages a workspace hoisted away", () => {
    expect(_installedPackages(dir)).toEqual([
      { name: "@zerotal/core", version: ZEROTAL_VERSION, direct: false },
      { name: "@zerotal/notifications", version: ZEROTAL_VERSION, direct: true },
      { name: "@zerotal/orm", version: ZEROTAL_VERSION, direct: false },
      { name: "zerotal", version: ZEROTAL_VERSION, direct: true },
    ]);
  });

  it("is empty before an install", () => {
    rmSync(join(dir, "node_modules"), { recursive: true });
    expect(_installedPackages(dir)).toEqual([]);
  });
});

describe("_aboutReport", () => {
  it("lists each package the app lacks once, with every need it covers", async () => {
    const report = await _aboutReport(dir, async () => CAPABILITIES);
    expect(report.available).toEqual([
      { pkg: "@zerotal/tenancy", needs: ["Multi-tenancy", "Tenant-aware queues"], doc: "tenancy" },
    ]);
    expect(report.app).toEqual({ name: "shop", version: "0.0.1" });
  });

  it("says where the index lives when @zerotal/arch is not installed", async () => {
    const report = await _aboutReport(dir, async () => null);
    expect(report.available).toBeNull();
    expect(_formatAbout(report)).toContain("bun add @zerotal/arch");
  });

  it("reads the real index from the app's own @zerotal/arch", async () => {
    // This repository's arch, linked in the way a workspace install links it.
    symlinkSync(join(import.meta.dir, "../../../../arch"), join(dir, "node_modules/@zerotal/arch"));
    const report = await _aboutReport(dir);
    expect(report.installed.map((p) => p.name)).toContain("@zerotal/arch");
    expect(report.available?.map((a) => a.pkg)).toContain("@zerotal/tenancy");
  });
});

describe("_formatAbout", () => {
  it("prints versions, the install command and the page, and flags a package out of step", async () => {
    pkg("node_modules/@zerotal/orm", { name: "@zerotal/orm", version: "0.0.1-old" });
    const text = _formatAbout(await _aboutReport(dir, async () => CAPABILITIES));
    expect(text).toContain(`Zerotal ${ZEROTAL_VERSION}`);
    expect(text).toContain("@zerotal/orm");
    expect(text).toContain(`← not ${ZEROTAL_VERSION}`);
    expect(text).toContain("(through zerotal)");
    expect(text).toContain("bun add @zerotal/tenancy");
    expect(text).toContain("https://zerotal.dev/docs/tenancy");
    expect(text).not.toContain("bun add @zerotal/notifications");
  });
});
