/**
 * `PasswordReset` — a model mixin adding stateless, signed password-reset links
 * (no database table).
 *
 * @remarks
 * A reset token is `Crypt`-encrypted claims: the user id, a fingerprint of the
 * current password hash (`pwfp`), a unique id (`jti`), and an expiry (`exp`).
 * Nothing is persisted, so there is nothing to leak or prune. The link is
 * effectively **single-use two ways**: the password fingerprint stops matching
 * the instant the password changes, and the consumed `jti` is marked used in the
 * cache (until it would expire) so a replay is rejected. Unlike email
 * verification, reset targets someone locked out, so it is **public** (no auth)
 * and {@link PasswordReset.resetPassword} is **static** — the user is resolved
 * from the token itself.
 *
 * @example
 * ```ts
 * class User extends Model.using(Authenticatable, PasswordReset) {}
 *
 * // 1. Locked-out user requests a reset — email the link:
 * const token = user.createPasswordResetToken();          // /reset-password?token=<token>
 *
 * // 2. They submit the form with a new password:
 * const user = await User.resetPassword(token, newPassword); // updated user, or null on failure
 * if (!user) return badRequest("This reset link is invalid or has expired.");
 * ```
 * @packageDocumentation
 */

import { type Constructor } from "@zerotal/orm";
import { Hash } from "./facades/Hash.ts";
import {
  signToken,
  readToken,
  fingerprint,
  newJti,
  nowSeconds,
  isLinkUsed,
  markLinkUsed,
} from "./linkTokens.ts";

const KIND = "password-reset";

/** Brand marking a model (or an ancestor) as carrying the password-reset contract. */
export const PASSWORD_RESET: unique symbol = Symbol.for("zerotal.auth.passwordReset");

/** True when the given model constructor composes `PasswordReset`. */
export function hasPasswordReset(model: unknown): boolean {
  return !!(model as Record<symbol, unknown> | undefined)?.[PASSWORD_RESET];
}

interface ResetClaims {
  /** Primary key of the user resetting their password. */
  id: number | string;
  /** Fingerprint of the password hash at issue time — invalidates the link once it changes. */
  pwfp: string;
  /** Unique token id, so a consumed link can be marked used (single-use via cache). */
  jti: string;
  /** Expiry as a UNIX timestamp (seconds). */
  exp: number;
}

export function PasswordReset<TBase extends Constructor>(Base: TBase) {
  class PasswordReset extends Base {
    /** Minutes a reset link stays valid. Override per-model. */
    static passwordResetExpireMinutes = 60;

    /**
     * Build a stateless, signed reset token for **this** user. Email the link
     * (`/reset-password?token=${token}`). Nothing is stored: the token carries the user id,
     * a fingerprint of the current password, a unique id, and an expiry — so it self-
     * invalidates once the password changes.
     *
     * @param expiresInMinutes - Link lifetime; defaults to the model's
     *   `passwordResetExpireMinutes` (60).
     * @returns The encrypted, URL-safe reset token to embed in the emailed link.
     */
    createPasswordResetToken(expiresInMinutes?: number): string {
      const minutes =
        expiresInMinutes ??
        (this.constructor as { passwordResetExpireMinutes?: number }).passwordResetExpireMinutes ??
        60;
      const claims: ResetClaims = {
        id: (this as unknown as { id: number | string }).id,
        pwfp: fingerprint((this as { password?: string }).password ?? ""),
        jti: newJti(),
        exp: nowSeconds() + minutes * 60,
      };
      return signToken(claims);
    }

    /**
     * Verify a reset `token` and set `newPassword` on the matching user. Static — the user
     * is resolved from the token (the requester is locked out, so there's no session).
     *
     * @remarks
     * The new password is hashed via `Hash.make` before being saved. On success the
     * link's `jti` is marked used in the cache (until its `exp`) to block replays, and the
     * user's "remember me" token is nulled so no persistent-login cookie outlives the reset.
     *
     * @param token - The reset token from the emailed link.
     * @param newPassword - The plaintext new password (hashed before persisting).
     * @returns The updated user on success, or `null` when the token is tampered, expired,
     *   or malformed, the user is gone, the link was already used, or the password has since
     *   changed (the link is single-use).
     */
    static async resetPassword(token: string, newPassword: string): Promise<PasswordReset | null> {
      const claims = readToken<ResetClaims>(token);
      if (!claims || claims.id == null || typeof claims.exp !== "number") return null;
      if (nowSeconds() > claims.exp) return null;

      const Model = this as unknown as { find(id: number | string): Promise<unknown> };
      const user = (await Model.find(claims.id)) as
        | (PasswordReset & {
            password?: string;
            setRememberToken?(value: string | null): void;
            save(): Promise<unknown>;
          })
        | null;
      if (!user) return null;

      // Single-use: the fingerprint stops matching once the password changes, and a replay
      // of the consumed link's id is rejected via the cache.
      if (fingerprint(user.password ?? "") !== claims.pwfp) return null;
      if (typeof claims.jti === "string" && (await isLinkUsed(KIND, claims.jti))) return null;

      user.password = await Hash.make(newPassword);
      // Revoke the persistent-login credential too. `RememberMeMiddleware` re-authenticates
      // from `sha256(cookie) === storedHash` alone, with no reference to the password — so
      // without this the canonical "I've been compromised, I'll reset my password" flow
      // leaves the attacker's remember cookie working. Sessions are evicted separately:
      // `AuthenticateSessionMiddleware` compares its snapshot against the password hash,
      // which just changed.
      user.setRememberToken?.(null);
      await user.save();
      if (typeof claims.jti === "string") await markLinkUsed(KIND, claims.jti, claims.exp);
      return user;
    }
  }

  (PasswordReset as unknown as Record<symbol, unknown>)[PASSWORD_RESET] = true;
  return PasswordReset;
}
