import { describe, it, expect, afterAll } from "bun:test";
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCachedPath } from "./cache.ts";

/**
 * Regression: the cache version used to be a hand-bumped constant, so changing the compiler's
 * emit logic without bumping it kept serving stale compiled pages — surviving server restarts,
 * because the cache lives on disk. It now fingerprints the compiler's own sources, so any emit
 * change invalidates every cached page automatically.
 */
describe("compiled-page cache version", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const cacheMod = join(dir, "cache.ts");
  const probe = join(dir, "directives.ts");
  const scratch = mkdtempSync(join(tmpdir(), "flow-cache-"));

  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  /** The cache filename the CURRENT compiler sources produce, computed in a fresh process. */
  function keyInFreshProcess(): string {
    const r = Bun.spawnSync([
      "bun",
      "-e",
      `const {writeCache}=await import(${JSON.stringify(cacheMod)});` +
        `console.log(await writeCache("SRC","//x","f",${JSON.stringify(scratch)}));`,
    ]);
    return r.stdout.toString().trim();
  }

  it("changes when the compiler's source changes", () => {
    const before = keyInFreshProcess();
    const orig = readFileSync(probe, "utf8");
    try {
      writeFileSync(probe, orig + "\n// fingerprint probe\n");
      expect(keyInFreshProcess()).not.toBe(before); // a compiler edit MUST invalidate cached pages
    } finally {
      writeFileSync(probe, orig);
    }
    expect(readFileSync(probe, "utf8")).toBe(orig); // probe file restored
  });

  it("is stable across processes when nothing changed", () => {
    expect(keyInFreshProcess()).toBe(keyInFreshProcess());
  });

  it("still returns null for an uncached source", () => {
    expect(getCachedPath("never-compiled-source", join(scratch, "empty"))).toBeNull();
  });
});
