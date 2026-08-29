/**
 * Password reset flow -- DB-agnostic, injectable query functions.
 */
import { FrameworkEvents, safeEqual, sha256Hex } from "@zerotal/core";
import { PasswordResetLinkSent, PasswordReset as PasswordResetEvent } from "./events.ts";

// -- Result constants ----------------------------------------------------------

/**
 * Typed result constants returned by {@link PasswordBroker}.
 *
 * @example
 * ```ts
 * import { PasswordBroker, PASSWORDS } from '@zerotal/auth';
 *
 * const result = await broker.reset(token, email, newPassword);
 * if (result === PASSWORDS.RESET) { ... }
 * if (result === PASSWORDS.TOKEN) { ... }
 * ```
 */
export const PASSWORDS = {
  /** Token sent successfully. */
  SENT: "passwords.sent",
  /** Token invalid, expired, or not found. */
  TOKEN: "passwords.token",
  /** Password reset successfully. */
  RESET: "passwords.reset",
} as const;

export type PasswordBrokerResult = (typeof PASSWORDS)[keyof typeof PASSWORDS];

// -- Internal helpers ---------------------------------------------------------

function _plainToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

export interface PasswordBrokerOptions {
  /** Minutes until a reset token expires. Default: 60. */
  expireMinutes?: number | undefined;
  findToken(email: string): Promise<{ token: string; createdAt: Date } | null>;
  storeToken(email: string, hash: string, expiresAt: Date): Promise<void>;
  deleteToken(email: string): Promise<void>;
  pruneTokens(cutoff: Date): Promise<void>;
  sendResetLink(email: string, token: string): Promise<void>;
  resetPassword(email: string, newPassword: string): Promise<void>;
}

/**
 * Stateful, DB-backed password-reset broker (an alternative to the stateless
 * {@link PasswordReset} mixin).
 *
 * @remarks
 * Persistence is delegated to the injected callbacks in {@link PasswordBrokerOptions},
 * so this class is database-agnostic. Security properties: only the **SHA-256 hash**
 * of the reset token is stored, and {@link reset} compares the presented token's hash
 * against it in **constant time** (`safeEqual`). A token is single-use — it is deleted
 * on a successful reset — and expired tokens are rejected (and pruned) on use.
 *
 * @example
 * ```ts
 * const broker = new PasswordBroker({
 *   findToken, storeToken, deleteToken, pruneTokens,
 *   sendResetLink: (email, token) => Mail.to(email).send(new ResetLink(token)),
 *   resetPassword: (email, pw) => User.query().where("email", email).update({ password: pw }),
 * });
 *
 * await broker.sendResetLink(email);                     // PASSWORDS.SENT
 * const result = await broker.reset(token, email, newPw); // PASSWORDS.RESET | PASSWORDS.TOKEN
 * ```
 */
export class PasswordBroker {
  private readonly _expire: number; // ms

  constructor(private readonly _opts: PasswordBrokerOptions) {
    this._expire = (this._opts.expireMinutes ?? 60) * 60 * 1000;
  }

  /**
   * Generate a reset token, store its hash, and send the plaintext to the user.
   *
   * @param email - The address requesting the reset.
   * @returns `PASSWORDS.SENT`.
   */
  async sendResetLink(email: string): Promise<"passwords.sent"> {
    const plain = _plainToken();
    const hash = sha256Hex(plain);
    const expiresAt = new Date(Date.now() + this._expire);

    await this._opts.storeToken(email, hash, expiresAt);
    await this._opts.sendResetLink(email, plain);

    FrameworkEvents.emit(new PasswordResetLinkSent(email));
    return "passwords.sent";
  }

  /**
   * Verify token + email and reset the password if valid.
   *
   * @remarks The stored token is matched by constant-time hash comparison; on
   * success the token is consumed (deleted). Expired tokens are deleted and rejected.
   *
   * @param token - The plaintext reset token from the emailed link.
   * @param email - The address the token was issued for.
   * @param newPassword - The new password to persist (via the `resetPassword` callback).
   * @returns `PASSWORDS.RESET` on success, `PASSWORDS.TOKEN` when missing, expired, or wrong.
   */
  async reset(
    token: string,
    email: string,
    newPassword: string,
  ): Promise<"passwords.token" | "passwords.reset"> {
    const record = await this._opts.findToken(email);
    if (!record) return "passwords.token";

    if (record.createdAt.getTime() + this._expire < Date.now()) {
      await this._opts.deleteToken(email);
      return "passwords.token";
    }

    // Constant-time compare — `!==` on the candidate hash would leak how many
    // leading bytes match through response timing.
    if (!safeEqual(sha256Hex(token), record.token)) return "passwords.token";

    await this._opts.resetPassword(email, newPassword);
    await this._opts.deleteToken(email);

    FrameworkEvents.emit(new PasswordResetEvent(email));
    return "passwords.reset";
  }

  /** Remove expired tokens. Call from a scheduled task. */
  async prune(): Promise<void> {
    await this._opts.pruneTokens(new Date(Date.now() - this._expire));
  }
}
