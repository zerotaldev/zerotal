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

  /** Override the key explicitly (otherwise derived from `APP_KEY`). */
  setKey(key: string): void {
    this._key = this._derive(key);
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
    let data: Buffer;
    try {
      data = Buffer.from(payload, "base64");
    } catch {
      throw new DecryptionError();
    }
    if (data.length < IV_BYTES + TAG_BYTES) throw new DecryptionError();
    const iv = data.subarray(0, IV_BYTES);
    const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = data.subarray(IV_BYTES + TAG_BYTES);
    try {
      const decipher = createDecipheriv("aes-256-gcm", this._resolveKey(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new DecryptionError();
    }
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
