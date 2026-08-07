import { describe, it, expect, beforeAll } from "bun:test";
import { Crypt, CryptKeyMissingError, DecryptionError } from "./Crypt.ts";

beforeAll(() =>
  Crypt.setKey("base64:" + Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")),
);

describe("Crypt", () => {
  it("round-trips a string", () => {
    const token = Crypt.encryptString("hello world");
    expect(token).not.toContain("hello");
    expect(Crypt.decryptString(token)).toBe("hello world");
  });
  it("produces a different ciphertext each call (random IV)", () => {
    expect(Crypt.encryptString("x")).not.toBe(Crypt.encryptString("x"));
  });
  it("round-trips arbitrary values", () => {
    const blob = Crypt.encrypt({ userId: 7, roles: ["admin"] });
    expect(Crypt.decrypt<{ userId: number }>(blob)).toEqual({ userId: 7, roles: ["admin"] });
  });
  it("rejects a tampered payload", () => {
    const token = Crypt.encryptString("secret");
    const bytes = Buffer.from(token, "base64");
    bytes[bytes.length - 1]! ^= 0xff;
    expect(() => Crypt.decryptString(bytes.toString("base64"))).toThrow(DecryptionError);
  });
  it("rejects a too-short payload", () => {
    expect(() => Crypt.decryptString("AAAA")).toThrow(DecryptionError);
  });
  it("rejects a payload encrypted with a different key", () => {
    const token = Crypt.encryptString("secret");
    Crypt.setKey("a-totally-different-key");
    expect(() => Crypt.decryptString(token)).toThrow(DecryptionError);
    Crypt.setKey("base64:" + Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")); // restore
  });
});

describe("CryptKeyMissingError", () => {
  it("has the E_CRYPT_NO_KEY code", () => {
    expect(new CryptKeyMissingError().code).toBe("E_CRYPT_NO_KEY");
  });
});
