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
  declaredBunFloor,
  runtimeBelowFloor,
  runtimeBelowFloorMessage,
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

/** A throwaway project root whose `package.json` is exactly `contents`. */
function manifest(contents: Record<string, unknown>, nested = ""): string {
  const root = mkdtempSync(join(tmpdir(), "zt-runtime-"));
  temporaries.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify(contents));
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

/**
 * `engines.bun` is written by every generated app and, until now, enforced by
 * nothing — the module's own opening line says so. `runtimeMismatch` does not cover
 * it: that compares against an *installed* Bun, and most projects do not install Bun
 * as a package, so it correctly says nothing about most of them.
 */
describe("declaredBunFloor", () => {
  it("reads engines.bun out of the project's package.json", () => {
    expect(declaredBunFloor(manifest({ engines: { bun: ">=1.4.0" } }))?.range).toBe(">=1.4.0");
  });

  it("walks up, so a workspace app finds the root's floor", () => {
    const app = manifest({ engines: { bun: ">=1.4.0" } }, join("apps", "web"));
    expect(declaredBunFloor(app)?.range).toBe(">=1.4.0");
  });

  it("takes the nearest floor, because that one is the app's own", () => {
    const root = manifest({ engines: { bun: ">=1.0.0" } });
    const app = join(root, "apps", "web");
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, "package.json"), JSON.stringify({ engines: { bun: ">=1.4.0" } }));
    expect(declaredBunFloor(app)?.range).toBe(">=1.4.0");
  });

  it("is null when nothing up the tree declares one", () => {
    expect(declaredBunFloor(manifest({ name: "app" }))).toBeNull();
  });
});

describe("runtimeBelowFloor", () => {
  it("reports the shortfall when the running Bun is under the declared floor", () => {
    const floor = runtimeBelowFloor(manifest({ engines: { bun: ">=99.0.0" } }));
    expect(floor).not.toBeNull();
    expect(floor?.running).toBe(Bun.version);
    expect(floor?.required).toBe(">=99.0.0");
    expect(floor?.manifest).toContain("package.json");
  });

  it("is null when the floor is met", () => {
    expect(runtimeBelowFloor(manifest({ engines: { bun: ">=0.1.0" } }))).toBeNull();
  });

  it("is null when the project declares no floor", () => {
    expect(runtimeBelowFloor(manifest({ name: "app" }))).toBeNull();
  });

  it("treats a range it cannot parse as satisfied", () => {
    // Refusing to boot because we could not read a version range is worse than the
    // mismatch it would have prevented.
    expect(runtimeBelowFloor(manifest({ engines: { bun: "whatever-is-latest" } }))).toBeNull();
  });
});

describe("runtimeBelowFloorMessage", () => {
  it("names both versions, the manifest, and the way out", () => {
    const message = runtimeBelowFloorMessage({
      running: "1.3.14",
      required: ">=1.4.0",
      manifest: "/app/package.json",
    });
    expect(message).toContain("1.3.14");
    expect(message).toContain(">=1.4.0");
    expect(message).toContain("/app/package.json");
    expect(message).toContain("bun upgrade");
    expect(message).toContain(RUNTIME_MISMATCH_ESCAPE);
  });
});

/**
 * A runtime the project never asked for is not two runtimes in play.
 *
 * The common way to acquire a `node_modules/bun` is not to want one:
 * `bun-plugin-tailwind` declares `bun` as a *required* peer, so `bun install`
 * fetches the Bun npm package as a second, usually newer runtime. Nobody executes
 * it — it is a directory — and refusing to boot over it crash-looped an app behind
 * a 502. Worse, the refusal's advice (`bun update bun`, or run through
 * `node_modules/.bin/bun`) is the wrong answer for that cause, and the obvious fix
 * it invites — deleting the directory after install — cannot work, because that
 * package's postinstall runs during install.
 */
describe("a chosen runtime versus a stray one", () => {
  /** A project root with `node_modules/bun` and a manifest that may or may not name it. */
  function withBun(installedVersion: string, declares: "dep" | "devDep" | "no"): string {
    const root = mkdtempSync(join(tmpdir(), "zt-runtime-"));
    temporaries.push(root);
    mkdirSync(join(root, "node_modules", "bun"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "bun", "package.json"),
      JSON.stringify({ name: "bun", version: installedVersion }),
    );
    const manifest: Record<string, unknown> = { name: "app" };
    if (declares === "dep") manifest["dependencies"] = { bun: "^1.0.0" };
    if (declares === "devDep") manifest["devDependencies"] = { bun: "^1.0.0" };
    writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
    return root;
  }

  it("marks a mismatch the project declared as chosen", () => {
    expect(runtimeMismatch(withBun("0.0.1-nope", "dep"))?.chosen).toBe(true);
    expect(runtimeMismatch(withBun("0.0.1-nope", "devDep"))?.chosen).toBe(true);
  });

  it("marks one nothing depends on as not chosen", () => {
    expect(runtimeMismatch(withBun("0.0.1-nope", "no"))?.chosen).toBe(false);
  });

  it("names the transitive peer, and warns against the fix that does not work", () => {
    const message = runtimeMismatchMessage({
      running: "1.3.14",
      installed: "1.4.0",
      manifest: "/app/node_modules/bun/package.json",
      chosen: false,
    });
    expect(message).toContain("bun-plugin-tailwind");
    expect(message).toContain("--omit=peer");
    expect(message).toContain("Do NOT remove node_modules/bun");
    // The advice for a chosen runtime would be actively misleading here.
    expect(message).not.toContain("bun update bun");
  });

  it("still gives the pick-one advice when the project chose the runtime", () => {
    const message = runtimeMismatchMessage({
      running: "1.3.14",
      installed: "1.4.0",
      manifest: "/app/node_modules/bun/package.json",
      chosen: true,
    });
    expect(message).toContain("bun update bun");
    expect(message).not.toContain("bun-plugin-tailwind");
  });
});
