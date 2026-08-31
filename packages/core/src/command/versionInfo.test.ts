import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _versionInfo, _formatVersion } from "./versionInfo.ts";
import type { _VersionInfo } from "./versionInfo.ts";
import { VersionCommand } from "./builtin/VersionCommand.ts";
import { BufferWriter } from "./OutputWriter.ts";
import { ZEROTAL_VERSION } from "../support/version.ts";

/** A throwaway project directory, optionally with a manifest and an installed Bun. */
function project(pkg?: Record<string, unknown>, installedBun?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "zt-version-"));
  if (pkg) writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  if (installedBun !== undefined) {
    mkdirSync(join(dir, "node_modules", "bun"), { recursive: true });
    writeFileSync(
      join(dir, "node_modules", "bun", "package.json"),
      JSON.stringify({ name: "bun", version: installedBun }),
    );
  }
  return dir;
}

describe("_versionInfo()", () => {
  it("reports the running framework and runtime", () => {
    const dir = project({ name: "demo", version: "2.3.4" });
    try {
      const info = _versionInfo(dir);
      expect(info.zerotal).toBe(ZEROTAL_VERSION);
      expect(info.bun).toBe(Bun.version);
      expect(info.app).toEqual({ name: "demo", version: "2.3.4" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("survives a project with no manifest", () => {
    const dir = project();
    try {
      const info = _versionInfo(dir);
      // Absence is not a finding — the framework and runtime are still reportable.
      expect(info.app).toBeNull();
      expect(info.zerotal).toBe(ZEROTAL_VERSION);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("survives a manifest that is not JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "zt-version-"));
    writeFileSync(join(dir, "package.json"), "{ not json");
    try {
      expect(_versionInfo(dir).app).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fills in a manifest missing name or version rather than reporting nothing", () => {
    const dir = project({ name: "half" });
    try {
      expect(_versionInfo(dir).app).toEqual({ name: "half", version: "(no version)" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("notices a second Bun in node_modules", () => {
    const dir = project({ name: "demo", version: "1.0.0" }, "0.0.1-not-the-one-running");
    try {
      expect(_versionInfo(dir).otherBun).toBe("0.0.1-not-the-one-running");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stays quiet when node_modules holds no Bun", () => {
    const dir = project({ name: "demo", version: "1.0.0" });
    try {
      expect(_versionInfo(dir).otherBun).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("_formatVersion()", () => {
  const base: _VersionInfo = {
    zerotal: "1.11.0",
    bun: "1.3.14",
    app: { name: "zerotal-admin", version: "0.1.0" },
    otherBun: null,
  };

  it("aligns the labels and carries no escape codes", () => {
    const out = _formatVersion(base);
    expect(out).toBe(
      ["Zerotal  1.11.0", "Bun      1.3.14", "App      zerotal-admin 0.1.0"].join("\n"),
    );
    // Pasted into bug reports and piped into scripts more than it is read on a
    // terminal, so it stays plain.
    expect(out).not.toContain("\x1b[");
  });

  it("omits the app row when there is no manifest", () => {
    const out = _formatVersion({ ...base, app: null });
    expect(out).not.toContain("App");
    expect(out).toContain("Zerotal  1.11.0");
  });

  it("reports a second Bun instead of staying silent about it", () => {
    const out = _formatVersion({ ...base, otherBun: "1.2.20" });
    expect(out).toContain("node_modules also contains bun 1.2.20");
  });

  it("says nothing when the second Bun is the one already running", () => {
    const out = _formatVersion({ ...base, otherBun: "1.3.14" });
    expect(out).not.toContain("node_modules");
  });
});

describe("VersionCommand", () => {
  it("declares itself as an app-free diagnostic", () => {
    expect(VersionCommand.commandName).toBe("version");
    // Must answer when the app does not boot — that is when it is asked.
    expect(VersionCommand.needsApp).toBe(false);
    expect(VersionCommand.flags.find((f) => f.name === "json")?.type).toBe("boolean");
  });

  it("prints the aligned report by default", async () => {
    const cmd = new VersionCommand();
    const writer = new BufferWriter();
    cmd._writer = writer;
    (cmd as unknown as Record<string, unknown>).flags = { json: false };

    await cmd.run();
    const out = writer.flush();
    expect(out).toContain(`Zerotal  ${ZEROTAL_VERSION}`);
    expect(out).toContain(`Bun      ${Bun.version}`);
  });

  it("prints parseable JSON under --json", async () => {
    const cmd = new VersionCommand();
    const writer = new BufferWriter();
    cmd._writer = writer;
    (cmd as unknown as Record<string, unknown>).flags = { json: true };

    await cmd.run();
    const parsed = JSON.parse(writer.flush()) as _VersionInfo;
    expect(parsed.zerotal).toBe(ZEROTAL_VERSION);
    expect(parsed.bun).toBe(Bun.version);
  });
});
