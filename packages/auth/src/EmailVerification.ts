/**
 * `EmailVerification` — a model mixin adding an `email_verified_at` timestamp plus
 * stateless, link-based email verification.
 *
 * @remarks
 * Compose it with `Model.using` — no `@column` needed: the column is registered
 * imperatively here, and `authSchemaConcern` adds it to the model's table at boot
 * if it is missing.
 *
 * **Whether you also need a migration depends on what your schema's source of
 * truth is** (`zt doctor` reports which). With the models as the source of truth,
 * you do not: the table is built from what the models declare, this column
 * included. With **migrations** as the source of truth, you do — the boot-time
 * concern only adds a column to a table that already exists, so a table created
 * by a migration that does not mention `email_verified_at` will not have it, and
 * every query touching the column fails with `no such column: email_verified_at`.
 *
 * Write that migration guarded:
 *
 * ```ts
 * if (!(await Schema.hasColumn("users", "email_verified_at"))) {
 *   await Schema.table("users", (t) => t.dateTime("email_verified_at").nullable());
 * }
 * ```
 *
 * Unguarded, it fails with `duplicate column name` on any database that has
 * booted the app since the mixin was composed — the concern will have added the
 * column already. That failure lands during a deployment's `migrate` step, which
 * is the worst moment to discover it.
 *
 * `remember_token` from {@link Authenticatable} is provisioned the same way and
 * carries the same condition.
 *
 * Verification links use a **stateless, encrypted token** (no database table): the
 * token is `Crypt`-encrypted (AES-256-GCM, keyed by APP_KEY) claims carrying the
 * user id, email, a unique id (`jti`), and an expiry, so it is tamper-proof and
 * reveals nothing in the URL. Both {@link createEmailVerificationToken} and
 * {@link verifyEmailToken} are **instance** methods: a user mints their own link and
 * verifies their own email (the token is checked against the caller's id + email),
 * so verification requires being signed in as the link's owner. The link stops
 * working when it expires, if the user's email changes, or once it has been used
 * (the `jti` is marked used in the cache).
 *
 * @example
 * ```ts
 * class User extends Model.using(Authenticatable, EmailVerification) {}
 *
 * user.hasVerifiedEmail();                         // boolean
 * const token = user.createEmailVerificationToken(); // email /verify-email/${token}
 *
 * // …the signed-in owner opens the link and confirms their own address:
 * const ok = await currentUser.verifyEmailToken(token); // true → email_verified_at stamped
 * ```
 * @packageDocumentation
 */

import { registerColumn, type Constructor } from "@zerotal/orm";
import { FrameworkEvents } from "@zerotal/core";
import { EmailVerified } from "./events.ts";
import {
  signToken,
  readToken,
  newJti,
  nowSeconds,
  isLinkUsed,
  markLinkUsed,
} from "./linkTokens.ts";

const KIND = "email-verify";

/** Brand marking a model (or an ancestor) as carrying the email-verification contract. */
export const EMAIL_VERIFICATION: unique symbol = Symbol.for("zerotal.auth.emailVerification");

/** True when the given model constructor composes `EmailVerification`. */
export function hasEmailVerification(model: unknown): boolean {
  return !!(model as Record<symbol, unknown> | undefined)?.[EMAIL_VERIFICATION];
}

interface VerificationClaims {
  /** Primary key of the user the link verifies. */
  id: number | string;
  /** Email at issue time — a changed address invalidates outstanding links. */
  email: string;
  /** Unique token id, so a consumed link can be marked used (single-use via cache). */
  jti: string;
  /** Expiry as a UNIX timestamp (seconds). */
  exp: number;
}

export function EmailVerification<TBase extends Constructor>(Base: TBase) {
  class EmailVerification extends Base {
    /** When the user confirmed their email address, or null/undefined if unverified. */
    declare emailVerifiedAt?: Date | null;

    /** Minutes a verification link stays valid. Override per-model. */
    static emailVerificationExpireMinutes = 60;

    /** True once the email address has been confirmed. */
    hasVerifiedEmail(): boolean {
      return (this as { emailVerifiedAt?: unknown }).emailVerifiedAt != null;
    }

    /** Stamp the email as verified (now) and persist. No-op if already verified. */
    async markEmailAsVerified(): Promise<this> {
      if (this.hasVerifiedEmail()) return this;
      (this as { emailVerifiedAt?: unknown }).emailVerifiedAt = new Date();
      await (this as unknown as { save(): Promise<unknown> }).save();
      FrameworkEvents.emit(new EmailVerified((this as unknown as { id: number | string }).id));
      return this;
    }

    /** Clear verification (e.g. after an email change), persisting the change. */
    async unverifyEmail(): Promise<this> {
      (this as { emailVerifiedAt?: unknown }).emailVerifiedAt = null;
      await (this as unknown as { save(): Promise<unknown> }).save();
      return this;
    }

    /**
     * Build a stateless, encrypted verification token for **this** user — drop it into
     * your verify link (`/verify-email/${token}`) and email it. Nothing is stored: the
     * token is `Crypt`-encrypted claims (user id + email + expiry), keyed by APP_KEY.
     *
     * @param expiresInMinutes - Link lifetime; defaults to the model's
     *   `emailVerificationExpireMinutes` (60).
     * @returns The encrypted, URL-safe verification token to embed in the emailed link.
     */
    createEmailVerificationToken(expiresInMinutes?: number): string {
      const minutes =
        expiresInMinutes ??
        (this.constructor as { emailVerificationExpireMinutes?: number })
          .emailVerificationExpireMinutes ??
        60;
      const claims: VerificationClaims = {
        id: (this as unknown as { id: number | string }).id,
        email: (this as { email?: string }).email ?? "",
        jti: newJti(),
        exp: nowSeconds() + minutes * 60,
      };
      return signToken(claims);
    }

    /**
     * Verify a token against **this** user and, on success, stamp them verified. Call it
     * on the authenticated user — verification requires being signed in as the link's
     * owner. Returns `false` when the token is tampered, expired, or malformed, was issued
     * for a different user or a since-changed email, or has already been used.
     *
     * @param token - The verification token from the emailed link.
     * @returns `true` when the caller's own, current email is verified; `false` otherwise.
     */
    async verifyEmailToken(token: string): Promise<boolean> {
      const claims = readToken<VerificationClaims>(token);
      if (!claims || claims.id == null || typeof claims.exp !== "number") return false;
      if (nowSeconds() > claims.exp) return false;

      // The link must belong to this signed-in user and their current email.
      if (String(claims.id) !== String((this as unknown as { id: number | string }).id)) {
        return false;
      }
      if (((this as { email?: string }).email ?? "") !== claims.email) return false;

      // Single-use: reject a replay of an already-consumed link.
      if (typeof claims.jti === "string" && (await isLinkUsed(KIND, claims.jti))) return false;

      await this.markEmailAsVerified();
      if (typeof claims.jti === "string") await markLinkUsed(KIND, claims.jti, claims.exp);
      return true;
    }
  }

  // Brand for boot-time detection (inherited by subclasses).
  (EmailVerification as unknown as Record<symbol, unknown>)[EMAIL_VERIFICATION] = true;

  // Register the column on this mixin class; columnsFor() walks the prototype chain,
  // so the concrete model hydrates/persists `email_verified_at` without declaring it.
  registerColumn(EmailVerification, "emailVerifiedAt", {
    type: "datetime",
    cast: "datetime",
    nullable: true,
  });

  return EmailVerification;
}
