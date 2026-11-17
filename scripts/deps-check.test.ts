/**
 * The detector behind `deps:check`.
 *
 * A dependency gate is only as good as its import scanner. The audit that led to
 * it found that a scanner reading only literal specifiers reported
 * `@zerotal/broadcasting` as an *unused* devDependency of flow, when flow loads it
 * through `const spec = "…"; import(spec)`. These pin each way a package can be
 * named, and each rule against the manifest shapes it was written for.
 */
import { describe, it, expect } from "bun:test";
import {
  checkManifest,
  checkSource,
  isPackageSpecifier,
  isUnbounded,
  lockResolver,
  packageOf,
  scanImports,
  type Manifest,
  type Policy,
} from "./deps-check.ts";

const NO_POLICY: Policy = { allowedDependencies: {} };
const noLock = () => null;

function rules(violations: { rule: string }[]): string[] {
  return violations.map((v) => v.rule).sort();
}

describe("scanImports", () => {
  it("separates static, type, dynamic and require imports", () => {
    const sites = scanImports(
      [
        `import { a } from "alpha";`,
        `import type { B } from "beta";`,
        `import { type C } from "gamma";`,
        `export * from "delta";`,
        `export type { E } from "epsilon";`,
        `type F = typeof import("zeta");`,
        `await import("eta");`,
        `require("theta");`,
      ].join("\n"),
    );
    expect(sites.map((s) => [s.spec, s.kind])).toEqual([
      ["alpha", "static"],
      ["beta", "type"],
      ["gamma", "type"],
      ["delta", "static"],
      ["epsilon", "type"],
      ["zeta", "type"],
      ["eta", "dynamic"],
      ["theta", "require"],
    ]);
  });

  it("sees a package held in a const, and marks it non-literal", () => {
    const [site] = scanImports(`const spec = "@zerotal/broadcasting";\nawait import(spec);\n`);
    expect(site).toMatchObject({ spec: "@zerotal/broadcasting", literal: false });
  });

  it("ignores app files, URLs, builtins and unresolvable variables", () => {
    const sites = scanImports(
      [
        `import { x } from "./local.ts";`,
        `import { readFileSync } from "node:fs";`,
        `import { join } from "path";`,
        `import { serve } from "bun";`,
        `import { Database } from "bun:sqlite";`,
        `await import(pathToFileURL(file).href);`,
        `await import(routeFile);`,
        `const migration = "C:/app/migrations/1.ts"; await import(migration);`,
        `await import("/abs/path.ts");`,
      ].join("\n"),
    );
    expect(sites).toEqual([]);
  });

  it("recognises the optional-peer shape, and only the exact shape", () => {
    const shaped = (code: string) => scanImports(code).map((s) => s.peerShape);

    expect(shaped(`await import("sharp" as string).catch(optionalPeer("sharp", hint));`)).toEqual([
      true,
    ]);
    // No `as string`: an app without the peer fails tsc on this line.
    expect(shaped(`await import("sharp").catch(optionalPeer("sharp", hint));`)).toEqual([false]);
    // A different name in the handler.
    expect(shaped(`await import("sharp" as string).catch(optionalPeer("other", hint));`)).toEqual([
      false,
    ]);
    // A handler that is not optionalPeer.
    expect(shaped(`await import("sharp" as string).catch(() => null);`)).toEqual([false]);
    // Inside a try, but with no optionalPeer.
    expect(shaped(`try { await import("sharp" as string); } catch { return null; }`)).toEqual([
      false,
    ]);
  });

  it("accepts require() in a try whose catch calls optionalPeer for the same name", () => {
    const ok = scanImports(
      `try { return require("@zerotal/cache"); } catch (e) { return optionalPeer("@zerotal/cache", h)(e); }`,
    );
    expect(ok[0]?.peerShape).toBe(true);

    const wrongName = scanImports(
      `try { return require("@zerotal/cache"); } catch (e) { return optionalPeer("other", h)(e); }`,
    );
    expect(wrongName[0]?.peerShape).toBe(false);
  });

  it("reports the line of each import", () => {
    const [, second] = scanImports(`import "a";\n\nimport "b";\n`);
    expect(second?.line).toBe(3);
  });
});

describe("specifiers", () => {
  it("knows packages from paths and builtins", () => {
    expect(isPackageSpecifier("sharp")).toBe(true);
    expect(isPackageSpecifier("@zerotal/core/runtime")).toBe(true);
    expect(isPackageSpecifier("react-dom/server")).toBe(true);
    expect(isPackageSpecifier("./x.ts")).toBe(false);
    expect(isPackageSpecifier("C:/x.ts")).toBe(false);
    expect(isPackageSpecifier("fs/promises")).toBe(false);
    expect(isPackageSpecifier("node:fs")).toBe(false);
    expect(isPackageSpecifier("bun:test")).toBe(false);
    expect(isPackageSpecifier("https://example.com/x.js")).toBe(false);
  });

  it("reduces a subpath to its package", () => {
    expect(packageOf("react-dom/server")).toBe("react-dom");
    expect(packageOf("@zerotal/core/runtime")).toBe("@zerotal/core");
    expect(packageOf("sharp")).toBe("sharp");
  });
});

describe("isUnbounded", () => {
  it("flags ranges with no ceiling", () => {
    expect(isUnbounded(">=0.70.0")).toBe(true);
    expect(isUnbounded("*")).toBe(true);
    expect(isUnbounded("latest")).toBe(true);
    expect(isUnbounded("")).toBe(true);
  });

  it("accepts ranges with one", () => {
    expect(isUnbounded(">=0.70.0 <2")).toBe(false);
    expect(isUnbounded("^0.33 || ^0.34")).toBe(false);
    expect(isUnbounded("^1 || ^2 || ^3")).toBe(false);
    expect(isUnbounded("^1.0.0")).toBe(false);
  });
});

describe("lockResolver", () => {
  const lock = {
    packages: {
      sharp: ["sharp@0.35.5", "", {}, "sha"],
      "@zerotal/media/sharp": ["sharp@0.34.1", "", {}, "sha"],
      "@zerotal/queue": ["@zerotal/queue@workspace:packages/queue"],
    },
  };
  const resolve = lockResolver(lock, new Map([["@zerotal/queue", "1.16.2"]]));

  it("prefers a workspace's nested copy over the hoisted one", () => {
    expect(resolve("@zerotal/media", "sharp")).toBe("0.34.1");
    expect(resolve("@zerotal/ai", "sharp")).toBe("0.35.5");
  });

  it("reads a workspace: entry as that workspace's own version", () => {
    expect(resolve("@zerotal/media", "@zerotal/queue")).toBe("1.16.2");
  });

  it("returns null for a package the lockfile does not have", () => {
    expect(resolve("@zerotal/ai", "@anthropic-ai/sdk")).toBeNull();
  });
});

describe("checkManifest", () => {
  const docs = "| `tailwind-merge` | … |";

  it("allows a listed and documented third-party dependency", () => {
    const manifest: Manifest = {
      name: "@zerotal/flow-ui",
      dependencies: { "@zerotal/core": "workspace:*", "tailwind-merge": "^3.7.0" },
    };
    const policy: Policy = {
      allowedDependencies: { "@zerotal/flow-ui": { "tailwind-merge": "reason" } },
    };
    expect(checkManifest("flow-ui", manifest, policy, noLock, docs)).toEqual([]);
  });

  it("fails an unlisted or undocumented one, but never a first-party one", () => {
    const manifest: Manifest = {
      name: "@zerotal/flow-ui",
      dependencies: { "@zerotal/core": "workspace:*", clsx: "^2.1.1" },
    };
    expect(rules(checkManifest("flow-ui", manifest, NO_POLICY, noLock, docs))).toEqual([
      "dependency-not-allowed",
      "undocumented-dependency",
    ]);
  });

  it("checks the peer blocks against each other and against the lockfile", () => {
    const manifest: Manifest = {
      name: "@zerotal/media",
      peerDependencies: { sharp: "^0.33 || ^0.34", "@anthropic-ai/sdk": ">=0.70.0" },
      peerDependenciesMeta: {
        sharp: { optional: true },
        "@anthropic-ai/sdk": { optional: true },
        "@zerotal/queue": { optional: true },
      },
      devDependencies: { sharp: "^0.35.5" },
    };
    const resolve = (_ws: string, dep: string) => (dep === "sharp" ? "0.35.5" : null);
    expect(rules(checkManifest("media", manifest, NO_POLICY, resolve, docs))).toEqual([
      "peer-dev-mismatch",
      "peer-meta-orphan",
      "peer-without-dev",
      "unbounded-peer",
    ]);
  });

  it("compares the installed version, not two ranges", () => {
    // `Bun.semver.satisfies("^0.35.5", "^0.35")` is false, though the two agree.
    const manifest: Manifest = {
      name: "@zerotal/media",
      peerDependencies: { sharp: "^0.35" },
      peerDependenciesMeta: { sharp: { optional: true } },
      devDependencies: { sharp: "^0.35.5" },
    };
    expect(checkManifest("media", manifest, NO_POLICY, () => "0.35.5", docs)).toEqual([]);
  });

  it("checks a workspace peer by the workspace's version", () => {
    const manifest: Manifest = {
      name: "@zerotal/media",
      peerDependencies: { "@zerotal/queue": "^1.0.0" },
      peerDependenciesMeta: { "@zerotal/queue": { optional: true } },
      devDependencies: { "@zerotal/queue": "workspace:*" },
    };
    expect(checkManifest("media", manifest, NO_POLICY, () => "1.16.2", docs)).toEqual([]);
    expect(rules(checkManifest("media", manifest, NO_POLICY, () => "2.0.0", docs))).toEqual([
      "peer-dev-mismatch",
    ]);
  });
});

describe("checkSource", () => {
  const manifest: Manifest = {
    name: "@zerotal/media",
    dependencies: { "@zerotal/core": "workspace:*", "@zerotal/orm": "workspace:*" },
    devDependencies: { "@zerotal/broadcasting": "workspace:*", sharp: "^0.35.5" },
    peerDependencies: { sharp: "^0.35" },
    peerDependenciesMeta: { sharp: { optional: true } },
  };
  const check = (code: string) =>
    rules(checkSource("media", "packages/media/src/x.ts", scanImports(code), manifest));

  it("allows any literal import of a hard dependency, lazy ones included", () => {
    expect(
      check(`import { a } from "@zerotal/core";\nconst { b } = await import("@zerotal/orm");`),
    ).toEqual([]);
  });

  it("allows the package to import itself", () => {
    expect(check(`import { x } from "@zerotal/media/testing";`)).toEqual([]);
  });

  it("fails an undeclared or dev-only import", () => {
    expect(check(`import { x } from "@zerotal/cache";`)).toEqual(["undeclared"]);
    expect(check(`await import("@zerotal/broadcasting");`)).toEqual(["dev-only"]);
  });

  it("holds an optional peer to the loading shape", () => {
    expect(check(`await import("sharp" as string).catch(optionalPeer("sharp", h));`)).toEqual([]);
    expect(check(`import sharp from "sharp";`)).toEqual(["optional-peer-static"]);
    expect(check(`import type { Sharp } from "sharp";`)).toEqual(["optional-peer-type-import"]);
    expect(check(`await import("sharp");`)).toEqual(["optional-peer-shape"]);
  });

  it("fails a package loaded through a variable, even a declared one", () => {
    expect(check(`const s = "@zerotal/orm";\nawait import(s);`)).toEqual(["variable-specifier"]);
  });

  it("reports one violation per rule, dependency and file", () => {
    expect(
      check(`import { a } from "@zerotal/cache";\nimport { b } from "@zerotal/cache";`),
    ).toEqual(["undeclared"]);
  });
});
