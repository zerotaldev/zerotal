/**
 * Password hashing over `Bun.password` — argon2id by default, bcrypt optional.
 * A zero-config core primitive available framework-wide (no provider required).
 *
 * @example
 * import { Hash } from '@zerotal/core';
 * const hash  = await Hash.make('secret123');
 * const valid = await Hash.verify('secret123', hash); // true
 */
/** Supported password-hashing algorithms. */
export type HashAlgorithm = "argon2id" | "argon2i" | "argon2d" | "bcrypt";

class HashManager {
  private _default: HashAlgorithm = "argon2id";

  /** Set the default hashing algorithm. */
  setDefault(algorithm: HashAlgorithm): void {
    this._default = algorithm;
  }

  /** Hash a value. Store the returned string. */
  async make(value: string, options: { algorithm?: HashAlgorithm } = {}): Promise<string> {
    return Bun.password.hash(value, { algorithm: options.algorithm ?? this._default });
  }

  /** Verify a value against a stored hash (algorithm auto-detected from the hash). */
  async verify(value: string, hash: string): Promise<boolean> {
    try {
      return await Bun.password.verify(value, hash);
    } catch {
      return false;
    }
  }

  /** Alias of {@link verify}. */
  async check(value: string, hash: string): Promise<boolean> {
    return this.verify(value, hash);
  }

  /** True when a hash was made with a different algorithm than the current default. */
  needsRehash(hash: string): boolean {
    return this._default.startsWith("argon")
      ? !hash.startsWith(`$${this._default}$`)
      : !hash.startsWith("$2"); // bcrypt
  }
}

/**
 * Password hashing primitive (argon2id by default).
 *
 * @example
 * ```ts
 * import { Hash } from "@zerotal/core/security";
 *
 * const digest = await Hash.make("hunter2");
 * await Hash.check("hunter2", digest);  // true
 * Hash.needsRehash(digest);             // false — re-hash on next login when true
 * ```
 */
export const Hash = new HashManager();
