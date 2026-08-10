/**
 * Encrypted columns — ciphertext at rest, plaintext on the model.
 *
 * The column stores an opaque AES-256-GCM payload keyed by `APP_KEY`; the model
 * property holds the value you assigned. Encryption happens on the way to the
 * database and decryption on the way back, so nothing in between — your code,
 * validation, `$dirty` — has to know the column is encrypted.
 *
 * Two ways to declare one, and they compile to the same thing:
 *
 * ```ts
 * class Client extends BaseModel {
 *   @column({ type: "text", nullable: true, cast: "encrypted" })
 *   idNumber?: string;
 *
 *   // …or, for several columns at once:
 *   static encryptable = ["idNumber", "passportNumber"];
 * }
 * ```
 *
 * **The column must be `text`, not `string`.** A payload is roughly a third
 * larger than its plaintext plus 28 bytes of IV and auth tag, so a 13-character
 * ID number lands around 60 characters and a paragraph overflows a `VARCHAR(255)`
 * that comfortably held it before.
 *
 * **You cannot query an encrypted column.** Every write draws a fresh IV, so the
 * same value encrypts to different ciphertext each time and an equality match can
 * never hit. `where()` on one throws rather than returning zero rows — see
 * {@link EncryptedColumnError}. If you need lookup, keep a separate hashed column
 * (a blind index) beside it and query that.
 *
 * **Decryption failure is fatal to the read**, deliberately. Returning the
 * ciphertext instead would put an unreadable value where the application expects
 * a real one — displayed to a user, written into a report, or re-encrypted on the
 * next save, which destroys the original for good.
 *
 * @packageDocumentation
 */

import { ZerotalError } from "@zerotal/core";
import { Crypt } from "@zerotal/core/security";

/** The cast names that mean "encrypt this column". */
export type EncryptedCastName = "encrypted" | "encrypted:json";

/** Raised for anything an encrypted column cannot do. */
export class EncryptedColumnError extends ZerotalError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, code, 500, context);
  }
}

/** Whether a resolved cast option is one of the encrypted ones. */
export function isEncryptedCast(cast: unknown): cast is EncryptedCastName {
  return cast === "encrypted" || cast === "encrypted:json";
}

/**
 * Model value → the ciphertext written to the column.
 *
 * @param label - `Model.column`, or just the column name, for error messages.
 */
export function encryptColumn(value: unknown, cast: EncryptedCastName, label: string): unknown {
  if (value === null || value === undefined) return value;

  if (cast === "encrypted:json") return Crypt.encryptString(JSON.stringify(value));

  if (typeof value !== "string") {
    // Not coerced with String(). `42` would store as "42" and read back as the
    // string "42" — the value's type silently changing between write and read,
    // which is worse than refusing it, because nothing fails until something
    // downstream compares it.
    throw new EncryptedColumnError(
      `[Zerotal] ${label} is cast "encrypted", which stores strings, but a ` +
        `${Array.isArray(value) ? "array" : typeof value} was assigned. Use ` +
        `cast: "encrypted:json" to encrypt a structured value — it round-trips the type.`,
      "E_ENCRYPTED_COLUMN_NOT_A_STRING",
      { column: label, received: typeof value },
    );
  }

  return Crypt.encryptString(value);
}

/**
 * Stored ciphertext → the value the model exposes.
 *
 * @param label - `Model.column`, for error messages.
 * @throws {@link EncryptedColumnError} When the stored value is not ciphertext
 *   this `APP_KEY` can open.
 */
export function decryptColumn(value: unknown, cast: EncryptedCastName, label: string): unknown {
  if (value === null || value === undefined) return value;

  let plain: string;
  try {
    plain = Crypt.decryptString(String(value));
  } catch (cause) {
    throw new EncryptedColumnError(
      `[Zerotal] Could not decrypt ${label}. The column is cast "${cast}", so what is ` +
        `stored has to be ciphertext this APP_KEY can open. Two things cause this: ` +
        `APP_KEY changed since the row was written (decrypt with the old key and ` +
        `re-save), or the column already held plaintext when the cast was added ` +
        `(back-fill the existing rows before switching it on). The row cannot be read ` +
        `until one of those is resolved.`,
      "E_ENCRYPTED_COLUMN_UNREADABLE",
      { column: label, cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }

  if (cast !== "encrypted:json") return plain;
  try {
    return JSON.parse(plain);
  } catch {
    // Decrypted cleanly, so the key is right and the bytes are intact — the
    // column simply was not written as JSON. Says so, rather than reporting a
    // key problem it does not have.
    throw new EncryptedColumnError(
      `[Zerotal] ${label} decrypted, but its contents are not JSON. The column is cast ` +
        `"encrypted:json"; a column written under plain "encrypted" reads back with that.`,
      "E_ENCRYPTED_COLUMN_NOT_JSON",
      { column: label },
    );
  }
}

/** The error thrown when someone tries to filter on an encrypted column. */
export function encryptedQueryError(label: string): EncryptedColumnError {
  return new EncryptedColumnError(
    `[Zerotal] Cannot filter on ${label} — it is an encrypted column. Every write draws ` +
      `a fresh IV, so the same value encrypts to different ciphertext each time and an ` +
      `equality match can never hit. Keep a separate hashed lookup column (a blind index) ` +
      `beside it and query that instead.`,
    "E_ENCRYPTED_COLUMN_NOT_QUERYABLE",
    { column: label },
  );
}

/**
 * Resolve `static encryptable = [...]` down a prototype chain into cast entries.
 *
 * Declaring it is exactly equivalent to putting `cast: "encrypted"` on each of
 * those columns, which is why it resolves to casts here rather than being handled
 * separately: read, write, `$dirty` and the query guard then all see one thing.
 *
 * A `json` column resolves to `encrypted:json` on its own — the alternative is
 * `String(someObject)` reaching the cipher as `"[object Object]"`.
 *
 * Entries union down the chain, so a base model marking a column encrypted keeps
 * it encrypted in a subclass that lists its own.
 *
 * @param chain - The constructor chain, base-most first.
 * @param columnType - Declared `@column({ type })` for a property, if any.
 */
export function collectEncryptable(
  chain: readonly object[],
  columnType: (key: string) => string | undefined,
): Record<string, EncryptedCastName> {
  const out: Record<string, EncryptedCastName> = {};
  for (const entry of chain) {
    const keys = (entry as { encryptable?: string[] }).encryptable;
    if (!keys) continue;
    for (const key of keys) {
      out[key] = columnType(key) === "json" ? "encrypted:json" : "encrypted";
    }
  }
  return out;
}
