import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { optionalPeer } from "./optionalPeer.ts";
import { OptionalPeerMissingError } from "../errors/OptionalPeerMissingError.ts";
import { ZerotalError } from "../errors/ZerotalError.ts";

// A name no registry package will ever take, so "not installed" is guaranteed.
const ABSENT = "zerotal-test-absent-optional-peer";

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "zt-optional-peer-"));
  // An installed peer that is itself broken: it imports a package nobody installed.
  writeFileSync(
    join(dir, "brokenDependency.mjs"),
    `import "zerotal-test-missing-transitive";\nexport const value = 1;\n`,
  );
  writeFileSync(
    join(dir, "brokenDependency.cjs"),
    `require("zerotal-test-missing-transitive");\nmodule.exports = 1;\n`,
  );
  writeFileSync(
    join(dir, "throwsOnLoad.mjs"),
    `throw new TypeError("peer failed to initialise");\n`,
  );
  writeFileSync(join(dir, "present.mjs"), `export const value = 42;\n`);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The rejection of a promise, or a failure when it resolves. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

describe("optionalPeer()", () => {
  test("a package that is not installed becomes OptionalPeerMissingError", async () => {
    const error = await rejection(
      import("zerotal-test-absent-optional-peer" as string).catch(
        optionalPeer(ABSENT, { feature: 'driver: "test"', alternative: 'driver: "bun"' }),
      ),
    );

    expect(error).toBeInstanceOf(OptionalPeerMissingError);
    expect(error).toBeInstanceOf(ZerotalError);
    const missing = error as OptionalPeerMissingError;
    expect(missing.code).toBe("E_OPTIONAL_PEER_MISSING");
    expect(missing.missing).toEqual({
      peer: ABSENT,
      feature: 'driver: "test"',
      install: `bun add ${ABSENT}`,
      alternative: 'driver: "bun"',
    });
    expect(missing.message).toContain(`driver: "test" needs the optional package "${ABSENT}"`);
    expect(missing.message).toContain(`Install it: bun add ${ABSENT}`);
    expect(missing.message).toContain('Or instead: driver: "bun"');
    // The resolver's own error survives, for whoever needs the path it searched.
    expect((missing.cause as { code?: string }).code).toBe("ERR_MODULE_NOT_FOUND");
  });

  test("the install command can be given, and a subpath installs its package", async () => {
    const custom = await rejection(
      import("zerotal-test-absent-optional-peer" as string).catch(
        optionalPeer(ABSENT, { feature: "f", install: "bun add -d thing" }),
      ),
    );
    expect((custom as OptionalPeerMissingError).missing.install).toBe("bun add -d thing");
    expect((custom as OptionalPeerMissingError).message).not.toContain("Or instead");

    const scoped = await rejection(
      import("@zerotal-test-absent/peer/server" as string).catch(
        optionalPeer("@zerotal-test-absent/peer/server", { feature: "f" }),
      ),
    );
    expect((scoped as OptionalPeerMissingError).missing.peer).toBe("@zerotal-test-absent/peer");
    expect((scoped as OptionalPeerMissingError).missing.install).toBe(
      "bun add @zerotal-test-absent/peer",
    );
  });

  test("an installed peer missing its own dependency is rethrown, not misreported", async () => {
    const url = pathToFileURL(join(dir, "brokenDependency.mjs")).href;
    const error = await rejection(import(url).catch(optionalPeer(url, { feature: "f" })));

    expect(error).not.toBeInstanceOf(OptionalPeerMissingError);
    expect((error as { specifier?: string }).specifier).toBe("zerotal-test-missing-transitive");
  });

  test("a different package name is never taken for the peer", async () => {
    // The import fails for ABSENT, but the handler was told to expect another name.
    const error = await rejection(
      import("zerotal-test-absent-optional-peer" as string).catch(
        optionalPeer("some-other-package", { feature: "f" }),
      ),
    );
    expect(error).not.toBeInstanceOf(OptionalPeerMissingError);
  });

  test("a peer that throws while loading is rethrown as it arrived", async () => {
    const url = pathToFileURL(join(dir, "throwsOnLoad.mjs")).href;
    const error = await rejection(import(url).catch(optionalPeer(url, { feature: "f" })));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe("peer failed to initialise");
  });

  test("errors that are not module errors pass through untouched", () => {
    const handle = optionalPeer(ABSENT, { feature: "f" });
    const original = new Error("unrelated");
    expect(() => handle(original)).toThrow(original);
    expect(() => handle("a string")).toThrow("a string");
    expect(() => handle({ code: "ERR_MODULE_NOT_FOUND" })).not.toThrow(OptionalPeerMissingError);
  });

  test("an installed peer loads through untouched", async () => {
    const url = pathToFileURL(join(dir, "present.mjs")).href;
    const mod: { value: number } = await import(url).catch(optionalPeer(url, { feature: "f" }));
    expect(mod.value).toBe(42);
  });

  test("require(): a missing peer and a broken one are told apart the same way", () => {
    const handle = optionalPeer(ABSENT, { feature: "f" });
    let missing: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("zerotal-test-absent-optional-peer");
    } catch (error) {
      try {
        handle(error);
      } catch (thrown) {
        missing = thrown;
      }
    }
    expect(missing).toBeInstanceOf(OptionalPeerMissingError);

    const path = join(dir, "brokenDependency.cjs");
    let broken: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(path);
    } catch (error) {
      try {
        optionalPeer(path, { feature: "f" })(error);
      } catch (thrown) {
        broken = thrown;
      }
    }
    expect(broken).not.toBeInstanceOf(OptionalPeerMissingError);
    expect((broken as { code?: string }).code).toBe("MODULE_NOT_FOUND");
  });
});

// The reason the call site is shaped the way it is. If a Bun release changes either
// half, the docs and every optional peer need to change with it — so this fails then.
describe("the bundler and the import shape", () => {
  async function bundles(source: string): Promise<boolean> {
    const entry = join(dir, `entry-${Math.random().toString(36).slice(2)}.ts`);
    writeFileSync(entry, source);
    try {
      const result = await Bun.build({ entrypoints: [entry], target: "bun", throw: false });
      return result.success;
    } catch {
      return false;
    }
  }

  test("an import with .catch() attached bundles when the package is absent", async () => {
    expect(
      await bundles(
        `const handle = (e: unknown): never => { throw e; };\n` +
          `export const load = () => import("${ABSENT}" as string).catch(handle);\n`,
      ),
    ).toBe(true);
  });

  test("an import handed to a helper as a thunk does not", async () => {
    expect(
      await bundles(
        `const run = (f: () => Promise<unknown>) => f().catch(() => null);\n` +
          `export const load = () => run(() => import("${ABSENT}"));\n`,
      ),
    ).toBe(false);
  });

  // A bundled require() of a package that was absent at build time throws the
  // bundler's own stub error, with no code and no specifier — what a compiled
  // app without the peer sees.
  test("a bundled require() of an absent package is still reported as missing", async () => {
    const entry = join(dir, "requireEntry.ts");
    writeFileSync(
      entry,
      `import { optionalPeer } from ${JSON.stringify(join(import.meta.dir, "optionalPeer.ts"))};\n` +
        `export function load(): unknown {\n` +
        `  try {\n` +
        `    return require("${ABSENT}");\n` +
        `  } catch (error) {\n` +
        `    return optionalPeer("${ABSENT}", { feature: "f" })(error);\n` +
        `  }\n` +
        `}\n` +
        `export function loadOther(): unknown {\n` +
        `  try {\n` +
        `    return require("${ABSENT}");\n` +
        `  } catch (error) {\n` +
        `    return optionalPeer("some-other-package", { feature: "f" })(error);\n` +
        `  }\n` +
        `}\n`,
    );
    const outdir = join(dir, "requireBundle");
    const result = await Bun.build({ entrypoints: [entry], target: "bun", outdir, throw: false });
    expect(result.success).toBe(true);

    const bundled = (await import(pathToFileURL(join(outdir, "requireEntry.js")).href)) as {
      load: () => unknown;
      loadOther: () => unknown;
    };
    // The bundle carries its own copy of the error class, so compare the code.
    const codeOf = (fn: () => unknown): unknown => {
      try {
        fn();
      } catch (error) {
        return (error as { code?: unknown }).code;
      }
      return "did not throw";
    };
    expect(codeOf(bundled.load)).toBe("E_OPTIONAL_PEER_MISSING");
    expect(codeOf(bundled.loadOther)).toBeUndefined();
  });
});
