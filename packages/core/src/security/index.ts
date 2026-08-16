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
// Signed URLs with a secret you manage yourself. Documented with a full example on the
// class, but previously reachable only through a deep internal path — which is a worse
// dependency to take than reimplementing it, so people reimplemented it. For app-key-keyed
// signing with no secret to manage, `Url.sign` / `Url.verify` on the http subpath is the
// higher-level option.
export { URLSigner } from "../crypt/URLSigner.ts";
// The redaction walk every recorder needs and each had written for itself. Not a
// policy — callers bring their own markers and their own sensitivity predicate,
// because an adapter implementing a published protocol does not get to choose
// its markers and a debug panel does.
export { redactGraph } from "./redactGraph.ts";
export type { RedactGraphOptions } from "./redactGraph.ts";
