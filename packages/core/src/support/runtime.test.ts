import { describe, expect, it, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installedBunVersion,
  runtimeMismatch,
  runtimeMismatchMessage,
  runtimeMismatchAllowed,
  bunBinary,
  RUNTIME_MISMATCH_ESCAPE,
} from "./runtime.ts";

const temporaries: string[] = [];

/** A throwaway project root, optionally with `node_modules/bun` installed in it. */
function project(version?: string, nested = ""): string {
  const root = mkdtempSync(join(tmpdir(), "zt-runtime-"));
  temporaries.push(root);
  if (version !== undefined) {
    mkdirSync(join(root, "node_modules", "bun"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "bun", "package.json"),
      JSON.stringify({ name: "bun", version }),
    );
  }
  if (nested) {
    const deep = join(root, nested);
    mkdirSync(deep, { recursive: true });
    return deep;
  }
  return root;
}

afterEach(() => {
  for (const dir of temporaries.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete Bun.env[RUNTIME_MISMATCH_ESCAPE];
});

describe("installedBunVersion", () => {
  it("reads the version out of node_modules/bun", () => {
    expect(installedBunVersion(project("1.3.14"))?.version).toBe("1.3.14");
  });

  it("walks up to a hoisted install, so a workspace package finds the root's copy", () => {
    const app = project("1.4.0", join("apps", "web"));
    expect(installedBunVersion(app)?.version).toBe("1.4.0");
  });

  it("is null when the project does not install Bun as a package", () => {
    expect(installedBunVersion(project())).toBeNull();
  });

  it("is null rather than throwing when the manifest is unreadable", () => {
    const root = mkdtempSync(join(tmpdir(), "zt-runtime-"));
    temporaries.push(root);
    mkdirSync(join(root, "node_modules", "bun"), { recursive: true });
    writeFileSync(join(root, "node_modules", "bun", "package.json"), "{ not json");
    expect(installedBunVersion(root)).toBeNull();
  });
});

describe("runtimeMismatch", () => {
  it("reports the disagreement when the installed Bun is not the running one", () => {
    const mismatch = runtimeMismatch(project("0.0.1-not-a-real-version"));
    expect(mismatch).not.toBeNull();
    expect(mismatch?.running).toBe(Bun.version);
    expect(mismatch?.installed).toBe("0.0.1-not-a-real-version");
    expect(mismatch?.manifest).toContain("package.json");
  });

  it("is null when the installed Bun is the running one", () => {
    expect(runtimeMismatch(project(Bun.version))).toBeNull();
  });

  it("is null when nothing is installed to disagree with", () => {
    expect(runtimeMismatch(project())).toBeNull();
  });

  it("compares exactly — a patch difference is still two binaries", () => {
    const [major, minor, patch] = Bun.version.split(".");
    const nextPatch = `${major}.${minor}.${Number(patch ?? 0) + 1}`;
    expect(runtimeMismatch(project(nextPatch))).not.toBeNull();
  });
});

describe("runtimeMismatchMessage", () => {
  it("names both versions, where the second came from, and the way out", () => {
    const message = runtimeMismatchMessage({
      running: "1.3.14",
      installed: "1.4.0",
      manifest: "/app/node_modules/bun/package.json",
    });
    expect(message).toContain("1.3.14");
    expect(message).toContain("1.4.0");
    expect(message).toContain("/app/node_modules/bun/package.json");
    expect(message).toContain("bun update bun");
    expect(message).toContain(RUNTIME_MISMATCH_ESCAPE);
  });
});

describe("runtimeMismatchAllowed", () => {
  it("is false when the escape hatch is unset", () => {
    expect(runtimeMismatchAllowed()).toBe(false);
  });

  it("accepts 1 and true, and nothing else", () => {
    Bun.env[RUNTIME_MISMATCH_ESCAPE] = "1";
    expect(runtimeMismatchAllowed()).toBe(true);
    Bun.env[RUNTIME_MISMATCH_ESCAPE] = "true";
    expect(runtimeMismatchAllowed()).toBe(true);
    Bun.env[RUNTIME_MISMATCH_ESCAPE] = "0";
    expect(runtimeMismatchAllowed()).toBe(false);
    Bun.env[RUNTIME_MISMATCH_ESCAPE] = "yes";
    expect(runtimeMismatchAllowed()).toBe(false);
  });
});

describe("bunBinary", () => {
  it("is the binary this process is running, not a name PATH resolves", () => {
    expect(bunBinary()).toBe(process.execPath);
    expect(bunBinary()).not.toBe("bun");
  });
});
