/**
 * Email one-time-password (OTP) login — a passwordless flow that emails a short
 * numeric code the user types back in. DB-agnostic via injected callbacks, in the
 * same style as {@link PasswordBroker}. Only the code's hash is stored, so a
 * leaked store cannot be used to log in.
 *
 * Brute-force hardening: a 6-digit code has only 10^6 possibilities, so each
 * code also carries a failed-attempt counter (encoded alongside the hash in the
 * existing `code` column — no schema change needed). After `maxAttempts` wrong
 * guesses (default 5) the code is invalidated, capping an online attacker at a
 * 5-in-a-million chance per issued code.
 *
 * @example
 * ```ts
 * const otp = new EmailOtpBroker({
 *   findCode:   (email) => Otp.query().where("email", email).first(),
 *   storeCode:  (email, hash, expiresAt) => Otp.upsert({ email, code: hash, expiresAt }),
 *   deleteCode: (email) => Otp.where("email", email).delete(),
 *   sendCode:   (email, code) => Mail.to(email).send(new LoginCode(code)),
 * });
 *
 * await otp.send("a@b.com");                    // emails a 6-digit code
 * const ok = await otp.attempt("a@b.com", code); // true on the right, unexpired code
 * ```
 * @packageDocumentation
 */
import { safeEqual, sha256Hex } from "@zerotal/core";

export interface EmailOtpOptions {
  /** Minutes a code stays valid. Default 10. */
  expireMinutes?: number | undefined;
  /** Number of digits in the code. Default 6. */
  length?: number | undefined;
  /**
   * Failed verification attempts allowed before the code is invalidated.
   * Default 5. Keeps a short numeric code from being brute-forced inside
   * its expiry window.
   */
  maxAttempts?: number | undefined;
  findCode(email: string): Promise<{ code: string; createdAt: Date } | null>;
  storeCode(email: string, hash: string, expiresAt: Date): Promise<void>;
  deleteCode(email: string): Promise<void>;
  sendCode(email: string, code: string): Promise<void>;
}

export class EmailOtpBroker {
  private readonly _expireMs: number;
  private readonly _length: number;
  private readonly _maxAttempts: number;

  constructor(private readonly _opts: EmailOtpOptions) {
    this._expireMs = (this._opts.expireMinutes ?? 10) * 60 * 1000;
    this._length = this._opts.length ?? 6;
    this._maxAttempts = this._opts.maxAttempts ?? 5;
  }

  /**
   * Generate a code, store its hash (with a zeroed attempt counter), and email the plaintext.
   * @param email - The recipient address; the code is stored keyed by this email.
   */
  async send(email: string): Promise<void> {
    const code = _numericCode(this._length);
    const stored = _encodeStored(sha256Hex(code), 0);
    await this._opts.storeCode(email, stored, new Date(Date.now() + this._expireMs));
    await this._opts.sendCode(email, code);
  }

  /**
   * Verify a code for an email. Returns `true` and consumes the code on success;
   * `false` when missing, expired, or wrong. Each wrong guess increments the
   * stored attempt counter; after `maxAttempts` failures the code is deleted so
   * an honest user can retry a typo, but a brute-forcer cannot walk the keyspace.
   *
   * @param email - The address the code was issued for.
   * @param code - The code entered by the user.
   * @returns `true` when the code is correct and unexpired (and is then consumed).
   */
  async attempt(email: string, code: string): Promise<boolean> {
    const record = await this._opts.findCode(email);
    if (!record) return false;

    const createdAt = record.createdAt.getTime();
    const expiresAt = createdAt + this._expireMs;
    if (expiresAt < Date.now()) {
      await this._opts.deleteCode(email);
      return false;
    }

    const { hash, attempts } = _decodeStored(record.code);

    if (_codeMatches(code, hash)) {
      await this._opts.deleteCode(email); // single-use: consume on success
      return true;
    }

    // Wrong guess: burn one attempt. Invalidate once the budget is spent so a
    // short numeric code cannot be brute-forced inside its expiry window.
    const nextAttempts = attempts + 1;
    if (nextAttempts >= this._maxAttempts) {
      await this._opts.deleteCode(email);
    } else {
      await this._opts.storeCode(email, _encodeStored(hash, nextAttempts), new Date(expiresAt));
    }
    return false;
  }
}

/**
 * Cryptographically-random zero-padded numeric code of the given length.
 *
 * @internal
 *
 * Uses rejection sampling so every digit is uniform: bytes >= 250 are discarded
 * rather than folded with `% 10`, which would bias digits 0-5 (256 mod 10 = 6).
 */
function _numericCode(length: number): string {
  const limit = 250; // largest multiple of 10 that fits in a byte
  let out = "";
  const buf = new Uint8Array(length);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const b = buf[i]!;
      if (b < limit) out += String(b % 10);
    }
  }
  return out;
}

/**
 * Encode the code hash and failed-attempt count into the single `code` column.
 * The hash is hex (no `.`), so a trailing `.<attempts>` is unambiguous and needs
 * no schema change.
 *
 * @internal
 */
function _encodeStored(hash: string, attempts: number): string {
  return `${hash}.${attempts}`;
}

/** @internal Inverse of {@link _encodeStored}; tolerates legacy bare-hash values. */
function _decodeStored(stored: string): { hash: string; attempts: number } {
  const dot = stored.lastIndexOf(".");
  if (dot === -1) return { hash: stored, attempts: 0 };
  const attempts = Number.parseInt(stored.slice(dot + 1), 10);
  return {
    hash: stored.slice(0, dot),
    attempts: Number.isFinite(attempts) ? attempts : 0,
  };
}

/** @internal Constant-time comparison of a raw code against its stored hash. */
function _codeMatches(rawCode: string, storedHash: string): boolean {
  return safeEqual(sha256Hex(rawCode), storedHash);
}
