import { describe, it, expect } from "bun:test";
import { Hash } from "./Hash.ts";

describe("Hash", () => {
  it("hashes and verifies (argon2id default)", async () => {
    const h = await Hash.make("secret123");
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await Hash.verify("secret123", h)).toBe(true);
    expect(await Hash.check("secret123", h)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    const h = await Hash.make("secret123");
    expect(await Hash.verify("wrong", h)).toBe(false);
  });
  it("returns false (not throw) for a malformed hash", async () => {
    expect(await Hash.verify("x", "not-a-hash")).toBe(false);
  });
  it("supports bcrypt", async () => {
    const h = await Hash.make("secret123", { algorithm: "bcrypt" });
    expect(h).toMatch(/^\$2[aby]\$/);
    expect(await Hash.verify("secret123", h)).toBe(true);
  });
  it("needsRehash flags a non-default algorithm", async () => {
    const bcryptHash = await Hash.make("x", { algorithm: "bcrypt" });
    expect(Hash.needsRehash(bcryptHash)).toBe(true); // default is argon2id
    const argonHash = await Hash.make("x");
    expect(Hash.needsRehash(argonHash)).toBe(false);
  });
  // Bun 1.4 refuses an argon2 memory cost under 8 KiB, where Bun 1.3 accepted it. Hash takes no
  // cost options and leaves Bun's own (64 MiB, two passes), so neither version can refuse it.
  it.each(["argon2id", "argon2i", "argon2d"] as const)(
    "hashes with %s at Bun's default cost",
    async (algorithm) => {
      const h = await Hash.make("secret123", { algorithm });
      const cost = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(h);
      expect(cost).not.toBeNull();
      expect(Number(cost![1])).toBeGreaterThanOrEqual(8);
      expect(Number(cost![2])).toBeGreaterThanOrEqual(1);
      expect(await Hash.verify("secret123", h)).toBe(true);
    },
  );
});
