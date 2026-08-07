/**
 * Password hashing service — wraps `Bun.password` natively. Bound in the
 * container as `hash` and reached through the {@link Hash} facade.
 *
 * @remarks
 * Uses **argon2id** by default (more secure than bcrypt for new projects). Pass
 * `"bcrypt"` to the constructor to fall back. The algorithm marker is embedded in
 * the hash string, so {@link check} verifies hashes of either algorithm and
 * {@link needsRehash} can detect stale ones.
 *
 * @param algorithm - Hashing algorithm for new hashes; defaults to `"argon2id"`.
 */
export class HashService {
  private _algorithm: "bcrypt" | "argon2id";

  constructor(algorithm: "bcrypt" | "argon2id" = "argon2id") {
    this._algorithm = algorithm;
  }

  /**
   * Hash a plain-text password with the configured algorithm.
   *
   * @param password - The plain-text password to hash.
   * @returns The hash string — store this in your database.
   * @example
   * ```ts
   * const hash = await Hash.make('secret123');
   * ```
   */
  async make(password: string): Promise<string> {
    return Bun.password.hash(password, { algorithm: this._algorithm });
  }

  /**
   * Verify a plain-text password against a stored hash. The algorithm is read
   * from the hash itself, so hashes made with either algorithm verify correctly.
   *
   * @param password - The plain-text password to check.
   * @param hash - The stored hash to compare against.
   * @returns `true` when the password matches.
   * @example
   * ```ts
   * const valid = await Hash.check('secret123', user.password);
   * ```
   */
  async check(password: string, hash: string): Promise<boolean> {
    return Bun.password.verify(password, hash);
  }

  /**
   * True when a stored hash should be re-hashed because it was produced with a
   * different algorithm than this service is configured to use. Re-hashing on
   * login keeps stored credentials current as you migrate algorithms (e.g.
   * bcrypt → argon2id) — see `Auth.attempt`, which rehashes transparently.
   *
   * Bun does not expose a native `needsRehash`, so we read the algorithm marker
   * encoded in the hash string: argon2id hashes begin `$argon2id$`, bcrypt
   * hashes begin `$2a$` / `$2b$` / `$2y$`.
   *
   * @param hash - The stored hash to inspect.
   * @returns `true` when the hash's algorithm differs from the configured one.
   */
  needsRehash(hash: string): boolean {
    if (this._algorithm === "argon2id") return !hash.startsWith("$argon2id$");
    return !/^\$2[aby]\$/.test(hash);
  }

  /**
   * Hash a password and verify it round-trips correctly. Used in tests and
   * health checks.
   *
   * @returns `true` when a freshly made hash verifies against its input.
   */
  async selfTest(): Promise<boolean> {
    const h = await this.make("test-ping");
    return this.check("test-ping", h);
  }
}
