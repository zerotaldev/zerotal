/**
 * Check a password against the Have I Been Pwned breach corpus using the
 * k-anonymity range API. Only the first five characters of the SHA-1 hash ever
 * leave the process; the full password and full hash are never transmitted.
 *
 * @example
 * ```ts
 * import { isPasswordCompromised } from "@zerotal/auth";
 *
 * if (await isPasswordCompromised(password)) {
 *   return back().withErrors({ password: ["This password has appeared in a data breach."] });
 * }
 * ```
 * @packageDocumentation
 */

export interface CompromisedCheckOptions {
  /**
   * Minimum number of breach appearances to count as compromised. Default `1`
   * (any appearance). Raise it to tolerate very common-but-low-risk hits.
   */
  threshold?: number;
  /** Override the range-API endpoint (for testing / self-hosting). */
  endpoint?: string;
}

/**
 * Returns `true` when the password appears in the breach corpus at least
 * `threshold` times. Fails **open** (returns `false`) on any network/API error,
 * so an outage never blocks a legitimate sign-up.
 *
 * @param password - The plaintext password to check (never sent in full).
 * @param opts - `threshold` (min breach count, default 1) and `endpoint` override.
 * @returns `true` when the password is compromised at/above `threshold`, else `false`.
 */
export async function isPasswordCompromised(
  password: string,
  opts: CompromisedCheckOptions = {},
): Promise<boolean> {
  const threshold = opts.threshold ?? 1;
  const endpoint = opts.endpoint ?? "https://api.pwnedpasswords.com/range";

  const hash = new Bun.CryptoHasher("sha1").update(password).digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    // "Add-Padding" makes every response a uniform size, hiding the real count
    // of matches from a network observer.
    const res = await fetch(`${endpoint}/${prefix}`, { headers: { "Add-Padding": "true" } });
    if (!res.ok) return false;

    const body = await res.text();
    for (const line of body.split("\n")) {
      const sep = line.indexOf(":");
      if (sep === -1) continue;
      if (line.slice(0, sep).trim().toUpperCase() === suffix) {
        const count = Number(line.slice(sep + 1).trim());
        return Number.isFinite(count) && count >= threshold;
      }
    }
    return false;
  } catch {
    return false; // fail open — never block on an outage
  }
}
