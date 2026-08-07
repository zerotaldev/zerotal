import { describe, it, expect } from "bun:test";
import { appKeyByteLength, appKeyStrengthWarning, MIN_APP_KEY_BYTES } from "./appKey.ts";

describe("appKeyByteLength", () => {
  it("counts UTF-8 bytes for a raw key", () => {
    expect(appKeyByteLength("abc")).toBe(3);
    expect(appKeyByteLength("a".repeat(44))).toBe(44);
  });

  it("decodes base64: keys to their byte length", () => {
    const b64 = Buffer.from(new Uint8Array(32)).toString("base64");
    expect(appKeyByteLength(`base64:${b64}`)).toBe(32);
  });
});

describe("appKeyStrengthWarning", () => {
  it("returns null for an absent key (handled at point-of-use)", () => {
    expect(appKeyStrengthWarning(undefined)).toBeNull();
    expect(appKeyStrengthWarning("")).toBeNull();
  });

  it("warns for a short/low-entropy key", () => {
    expect(appKeyStrengthWarning("secret")).toContain("key material");
    expect(appKeyStrengthWarning("a".repeat(MIN_APP_KEY_BYTES - 1))).not.toBeNull();
  });

  it("accepts a strong key (>= 32 bytes) and a generated base64 key", () => {
    expect(appKeyStrengthWarning("a".repeat(MIN_APP_KEY_BYTES))).toBeNull();
    const generated = Buffer.from(new Uint8Array(32)).toString("base64"); // key:generate format
    expect(appKeyStrengthWarning(generated)).toBeNull();
    expect(appKeyStrengthWarning(`base64:${generated}`)).toBeNull();
  });
});
