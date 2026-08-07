/**
 * Security primitives for Zerotal (the `@zerotal/core/security` subpath):
 * {@link Crypt} for `APP_KEY`-keyed AES-256-GCM encryption and {@link Hash} for
 * argon2id/bcrypt password hashing. Both are zero-config facades — no provider
 * registration required — that read `APP_KEY` from the environment on first use.
 *
 * @example
 * ```ts
 * import { Crypt, Hash } from "@zerotal/core/security";
 *
 * const token = Crypt.encryptString("secret");
 * Crypt.decryptString(token); // "secret"
 *
 * const digest = await Hash.make("hunter2");
 * await Hash.verify("hunter2", digest); // true
 * ```
 *
 * @packageDocumentation
 */
export { Crypt, CryptKeyMissingError, DecryptionError } from "../crypt/Crypt.ts";
export { Hash } from "../hash/Hash.ts";
export type { HashAlgorithm } from "../hash/Hash.ts";
