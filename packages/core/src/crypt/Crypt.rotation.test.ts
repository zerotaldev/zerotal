import { describe, it, expect, afterEach } from "bun:test";
import { Crypt, CryptKeyMissingError, DecryptionError } from "./Crypt.ts";

/**
 * Rotating `APP_KEY` with one key made everything already encrypted unreadable at once. The right
 * response to a leak is to rotate, and an app with a hundred encrypted columns had no way to do
 * it but to have every value entered again. `APP_PREVIOUS_KEYS` keeps the old keys for
 * decrypting; new values are only ever encrypted under the current one.
 *
 * These use fresh instances: `Crypt` is a process-wide singleton, and a key set on it would leak
 * into every other test file that runs after this one.
 */
type CryptInstance = typeof Crypt;
const fresh = (): CryptInstance => new (Crypt.constructor as new () => CryptInstance)();

const KEY_OLD = "base64:" + Buffer.from("old-old-old-old-old-old-old-old-!").toString("base64");
const KEY_MID = "base64:" + Buffer.from("mid-mid-mid-mid-mid-mid-mid-mid-!").toString("base64");
const KEY_NEW = "base64:" + Buffer.from("new-new-new-new-new-new-new-new-!").toString("base64");

/** An instance holding `key`, that can read nothing else. */
function under(key: string): CryptInstance {
  const instance = fresh();
  instance.setKey(key);
  instance.setPreviousKeys([]);
  return instance;
}

describe("previous keys", () => {
  it("decrypt what an old key encrypted, once the key is rotated", () => {
    const stored = under(KEY_OLD).encryptString("the operator's API key");

    const rotated = fresh();
    rotated.setKey(KEY_NEW);
    rotated.setPreviousKeys([KEY_OLD]);

    expect(rotated.decryptString(stored)).toBe("the operator's API key");
  });

  it("are never used to encrypt", () => {
    const rotated = fresh();
    rotated.setKey(KEY_NEW);
    rotated.setPreviousKeys([KEY_OLD]);

    const written = rotated.encryptString("new value");

    expect(() => under(KEY_OLD).decryptString(written)).toThrow(DecryptionError);
    expect(under(KEY_NEW).decryptString(written)).toBe("new value");
  });

  it("are tried in turn: any of several rotations ago still opens", () => {
    const fromOldest = under(KEY_OLD).encryptString("a");
    const fromMiddle = under(KEY_MID).encryptString("b");
    const rotated = fresh();
    rotated.setKey(KEY_NEW);
    rotated.setPreviousKeys([KEY_MID, KEY_OLD]);

    expect([rotated.decryptString(fromOldest), rotated.decryptString(fromMiddle)]).toEqual([
      "a",
      "b",
    ]);
  });

  it("do not weaken anything else: an unknown key, a tampered payload and a short one still fail", () => {
    const rotated = fresh();
    rotated.setKey(KEY_NEW);
    rotated.setPreviousKeys([KEY_OLD]);

    const stranger = under(
      "base64:" + Buffer.from("stranger-stranger-stranger-12345").toString("base64"),
    );
    expect(() => rotated.decryptString(stranger.encryptString("x"))).toThrow(DecryptionError);

    const bytes = Buffer.from(under(KEY_OLD).encryptString("y"), "base64");
    bytes[bytes.length - 1]! ^= 0xff;
    expect(() => rotated.decryptString(bytes.toString("base64"))).toThrow(DecryptionError);
    expect(() => rotated.decryptString("AAAA")).toThrow(DecryptionError);
  });

  it("cannot be used to read a payload when the key is gone altogether", () => {
    const saved = Bun.env["APP_KEY"];
    delete Bun.env["APP_KEY"];
    try {
      const keyless = fresh();
      keyless.setPreviousKeys([KEY_OLD]);

      expect(() => keyless.decryptString(under(KEY_OLD).encryptString("z"))).toThrow(
        CryptKeyMissingError,
      );
    } finally {
      if (saved !== undefined) Bun.env["APP_KEY"] = saved;
    }
  });
});

describe("APP_PREVIOUS_KEYS", () => {
  const saved = Bun.env["APP_PREVIOUS_KEYS"];
  afterEach(() => {
    if (saved === undefined) delete Bun.env["APP_PREVIOUS_KEYS"];
    else Bun.env["APP_PREVIOUS_KEYS"] = saved;
  });

  it("is read from the environment, comma-separated, ignoring spaces and empty entries", () => {
    const stored = under(KEY_OLD).encryptString("kept");
    Bun.env["APP_PREVIOUS_KEYS"] = ` ${KEY_MID} , ,${KEY_OLD},`;
    const rotated = fresh();
    rotated.setKey(KEY_NEW);

    expect(rotated.decryptString(stored)).toBe("kept");
  });

  it("is re-read when it changes, so forgetting a key takes effect", () => {
    const stored = under(KEY_OLD).encryptString("kept");
    const rotated = fresh();
    rotated.setKey(KEY_NEW);

    Bun.env["APP_PREVIOUS_KEYS"] = KEY_OLD;
    expect(rotated.decryptString(stored)).toBe("kept");

    Bun.env["APP_PREVIOUS_KEYS"] = "";
    expect(() => rotated.decryptString(stored)).toThrow(DecryptionError);
  });

  it("defaults to none", () => {
    delete Bun.env["APP_PREVIOUS_KEYS"];
    const rotated = fresh();
    rotated.setKey(KEY_NEW);

    expect(() => rotated.decryptString(under(KEY_OLD).encryptString("x"))).toThrow(DecryptionError);
  });
});

describe("moving stored values to the new key", () => {
  function rotated(): CryptInstance {
    const instance = fresh();
    instance.setKey(KEY_NEW);
    instance.setPreviousKeys([KEY_OLD]);
    return instance;
  }

  it("usesCurrentKey tells an old payload from a current one", () => {
    const crypt = rotated();

    expect(crypt.usesCurrentKey(under(KEY_NEW).encryptString("a"))).toBe(true);
    expect(crypt.usesCurrentKey(under(KEY_OLD).encryptString("a"))).toBe(false);
    expect(crypt.usesCurrentKey("not a payload")).toBe(false);
  });

  it("reencrypt moves a value to the current key without changing it", () => {
    const crypt = rotated();
    const old = under(KEY_OLD).encrypt({ userId: 7 });

    const moved = crypt.reencrypt(old);

    expect(crypt.usesCurrentKey(moved)).toBe(true);
    expect(under(KEY_NEW).decrypt<{ userId: number }>(moved)).toEqual({ userId: 7 });
    expect(() => under(KEY_OLD).decryptString(moved)).toThrow(DecryptionError);
  });

  it("reencrypt of a payload nothing can open fails rather than writing garbage", () => {
    expect(() => rotated().reencrypt("AAAA")).toThrow(DecryptionError);
  });
});
