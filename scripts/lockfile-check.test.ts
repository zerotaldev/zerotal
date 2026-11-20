/**
 * The detector behind `lockfile:check`.
 *
 * Bun 1.4 writes a lockfile Bun 1.3.14 cannot read, and the floor is what CI, the
 * release workflow and the docs server install with. These pin what counts as
 * the readable format, and that the committed lockfile is in it.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lockfileProblem, lockfileVersion, SUPPORTED_LOCKFILE_VERSION } from "./lockfile-check.ts";

const lock = (version: number) =>
  `{\n  "lockfileVersion": ${version},\n  "configVersion": 1,\n  "workspaces": {},\n}\n`;

describe("lockfileVersion", () => {
  it("reads the version from the head of the file", () => {
    expect(lockfileVersion(lock(1))).toBe(1);
    expect(lockfileVersion(lock(3))).toBe(3);
  });

  it("tolerates spacing a hand edit might leave", () => {
    expect(lockfileVersion(`{"lockfileVersion":2}`)).toBe(2);
  });

  it("is null when the field is missing", () => {
    expect(lockfileVersion(`{ "workspaces": {} }`)).toBeNull();
  });
});

describe("lockfileProblem", () => {
  it("passes the version Bun 1.3.14 reads", () => {
    expect(lockfileProblem(lock(SUPPORTED_LOCKFILE_VERSION))).toBeNull();
  });

  it("fails what Bun 1.4 writes, and says to regenerate with Bun 1.3.x", () => {
    for (const version of [2, 3]) {
      const problem = lockfileProblem(lock(version));
      expect(problem).toContain(`lockfileVersion ${version}`);
      expect(problem).toContain("Bun 1.3.x");
    }
  });

  it("fails an older version too, which the floor would migrate on install", () => {
    expect(lockfileProblem(lock(0))).toContain("lockfileVersion 0");
  });

  it("fails a file that declares no version", () => {
    expect(lockfileProblem(`{}`)).toContain("declares no lockfileVersion");
  });
});

describe("the committed lockfile", () => {
  it("is in the format the floor reads", () => {
    const text = readFileSync(join(import.meta.dir, "..", "bun.lock"), "utf8");
    expect(lockfileProblem(text)).toBeNull();
  });
});
