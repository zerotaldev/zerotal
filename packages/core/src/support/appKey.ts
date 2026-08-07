/**
 * APP_KEY strength check.
 *
 * `APP_KEY` is the single secret every signing and encryption primitive derives
 * from — sessions, signed URLs, Flow snapshots, remember-me tokens. Because
 * each derives its working key by hashing the value through SHA-256, *any* length
 * "works" mechanically, so a short or low-entropy key (`APP_KEY=secret`) silently
 * weakens the whole framework with no error. This surfaces that at boot instead.
 */

/** Minimum key material, in bytes. `key:generate` mints 32 random bytes. */
export const MIN_APP_KEY_BYTES = 32;

/**
 * Bytes of key material an `APP_KEY` carries: the decoded length for a
 * `base64:`-prefixed value, otherwise its UTF-8 byte length.
 */
export function appKeyByteLength(key: string): number {
  const raw = key.startsWith("base64:")
    ? Buffer.from(key.slice(7), "base64")
    : Buffer.from(key, "utf8");
  return raw.length;
}

/**
 * A warning message when `key` is too weak to key the framework's cryptography,
 * or `null` when it is absent (handled at point-of-use) or strong enough.
 */
export function appKeyStrengthWarning(key: string | undefined): string | null {
  if (!key) return null; // absence is enforced where the key is actually needed
  const bytes = appKeyByteLength(key);
  if (bytes >= MIN_APP_KEY_BYTES) return null;
  return (
    `[Zerotal] APP_KEY carries only ${bytes} bytes of key material (minimum ${MIN_APP_KEY_BYTES}). ` +
    `Every session, signed URL, and Flow snapshot derives from it, so a short key weakens them all. ` +
    `Generate a strong one with \`bun zt key:generate\`.`
  );
}
