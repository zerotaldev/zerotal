/**
 * Symmetric encryption keyed by `APP_KEY`.
 *
 * Uses AES-256-GCM (authenticated encryption): tampered or truncated payloads
 * fail to decrypt with a `DecryptionError` rather than returning garbage. The
 * key is derived from `APP_KEY` (raw or `base64:` prefixed) via SHA-256, so any
 * key length works; generate one with `zerotal key:generate`.
 *
 * @example
 * import { Crypt } from '@zerotal/core';
 * const token = Crypt.encryptString('secret');   // opaque base64
 * Crypt.decryptString(token);                     // 'secret'
 * const blob  = Crypt.encrypt({ userId: 7 });     // any JSON-serializable value
 * Crypt.decrypt<{ userId: number }>(blob).userId; // 7
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ZerotalError } from "../errors/ZerotalError.ts";

/** Raised when `Crypt` is used without an `APP_KEY` configured. */
export class CryptKeyMissingError extends ZerotalError {
  constructor() {
    super(
      "[Zerotal] Crypt requires APP_KEY. Generate one with `zerotal key:generate`.",
      "E_CRYPT_NO_KEY",
      500,
    );
  }
}

/** Raised when a payload cannot be decrypted — wrong key or tampered data. */
export class DecryptionError extends ZerotalError {
  constructor() {
    super(
      "[Zerotal] Could not decrypt the payload — wrong key or tampered data.",
      "E_DECRYPT",
      500,
    );
  }
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

class CryptManager {
  private _key: Buffer | null = null;
  /** Set explicitly with {@link setPreviousKeys}; otherwise `APP_PREVIOUS_KEYS` is read. */
  private _previous: Buffer[] | null = null;
  /** The last `APP_PREVIOUS_KEYS` value read, with the keys derived from it. */
  private _previousFromEnv: { raw: string; keys: Buffer[] } | null = null;

  /** Override the key explicitly (otherwise derived from `APP_KEY`). */
  setKey(key: string): void {
    this._key = this._derive(key);
  }

  /**
   * Keys to try after the current one when decrypting, newest first (otherwise read from
   * `APP_PREVIOUS_KEYS`, a comma-separated list). New values are never encrypted with them.
   *
   * Rotating `APP_KEY` with one key makes everything already encrypted unreadable, and the only
   * recovery is to have each value entered again. With the old key kept as a previous key,
   * stored values keep decrypting, and {@link reencrypt} moves them to the new one at your pace.
   */
  setPreviousKeys(keys: string[]): void {
    this._previous = keys.map((key) => this._derive(key));
  }

  private _previousKeys(): Buffer[] {
    if (this._previous) return this._previous;
    const raw = Bun.env["APP_PREVIOUS_KEYS"] ?? "";
    if (this._previousFromEnv?.raw === raw) return this._previousFromEnv.keys;
    const keys = raw
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key.length > 0)
      .map((key) => this._derive(key));
    this._previousFromEnv = { raw, keys };
    return keys;
  }

  private _derive(key: string): Buffer {
    const raw = key.startsWith("base64:")
      ? Buffer.from(key.slice(7), "base64")
      : Buffer.from(key, "utf8");
    return new Bun.CryptoHasher("sha256").update(raw).digest(); // exactly 32 bytes
  }

  private _resolveKey(): Buffer {
    if (this._key) return this._key;
    const appKey = Bun.env["APP_KEY"];
    if (!appKey) throw new CryptKeyMissingError();
    this._key = this._derive(appKey);
    return this._key;
  }

  /**
   * Encrypt a UTF-8 string. Returns an opaque base64 payload (iv+tag+ciphertext).
   *
   * @throws {CryptKeyMissingError} When no key is set and `APP_KEY` is absent.
   */
  encryptString(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this._resolveKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
  }

  /**
   * Decrypt a payload produced by {@link encryptString}.
   *
   * @throws {DecryptionError} When the payload is malformed, truncated, tampered
   *   with, or decrypted with the wrong key.
   * @throws {CryptKeyMissingError} When no key is set and `APP_KEY` is absent.
   */
  decryptString(payload: string): string {
    // The current key first, then each previous one. `_resolveKey()` stays outside the loop's
    // try so a missing APP_KEY is still a CryptKeyMissingError, not a failure to decrypt.
    const current = this._resolveKey();
    for (const key of [current, ...this._previousKeys()]) {
      const plain = this._tryDecrypt(payload, key);
      if (plain !== null) return plain;
    }
    throw new DecryptionError();
  }

  /** The plaintext under `key`, or `null` when the payload is malformed or `key` is not its key. */
  private _tryDecrypt(payload: string, key: Buffer): string | null {
    let data: Buffer;
    try {
      data = Buffer.from(payload, "base64");
    } catch {
      return null;
    }
    if (data.length < IV_BYTES + TAG_BYTES) return null;
    const iv = data.subarray(0, IV_BYTES);
    const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = data.subarray(IV_BYTES + TAG_BYTES);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }

  /**
   * Whether `payload` was encrypted with the current key, as opposed to a previous one (or none
   * of them). A `false` for a payload {@link decryptString} can read means it is due for
   * {@link reencrypt}.
   */
  usesCurrentKey(payload: string): boolean {
    return this._tryDecrypt(payload, this._resolveKey()) !== null;
  }

  /**
   * Decrypt `payload` with whichever known key opens it, and encrypt it again with the current one.
   * Idempotent: a payload already under the current key comes back as a fresh encryption of the
   * same value.
   *
   * @throws {DecryptionError} When no known key opens it.
   * @throws {CryptKeyMissingError} When no key is set and `APP_KEY` is absent.
   */
  reencrypt(payload: string): string {
    return this.encryptString(this.decryptString(payload));
  }

  /**
   * Encrypt any JSON-serializable value (serialized with `JSON.stringify`).
   *
   * @throws {CryptKeyMissingError} When no key is set and `APP_KEY` is absent.
   */
  encrypt(value: unknown): string {
    return this.encryptString(JSON.stringify(value));
  }

  /**
   * Decrypt a value produced by {@link encrypt}, parsing it back with `JSON.parse`.
   *
   * @typeParam T - Expected shape of the decrypted value.
   * @throws {DecryptionError} When the payload cannot be decrypted.
   * @throws {CryptKeyMissingError} When no key is set and `APP_KEY` is absent.
   */
  decrypt<T = unknown>(payload: string): T {
    return JSON.parse(this.decryptString(payload)) as T;
  }
}

/**
 * App-key symmetric encryption facade (AES-256-GCM).
 *
 * @example
 * ```ts
 * import { Crypt } from "@zerotal/core/security";
 *
 * const token = Crypt.encryptString("secret");
 * Crypt.decryptString(token); // "secret"
 *
 * const blob = Crypt.encrypt({ userId: 7 });
 * Crypt.decrypt<{ userId: number }>(blob).userId; // 7
 * ```
 */
export const Crypt = new CryptManager();
