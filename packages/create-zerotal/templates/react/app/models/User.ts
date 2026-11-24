import { Model, column, table } from "zerotal/orm";
import { Authenticatable, EmailVerification } from "zerotal/auth";
import { Notifiable } from "@zerotal/notifications";

/**
 * `Model.using(Authenticatable, …)`, not a plain `Model`.
 *
 * `Authenticatable` is what brands the class so `authUserModel()` can find it. Without
 * the brand nothing errors and nothing warns — the model saves, queries and hashes
 * exactly as before — but `Auth.attempt()` resolves *no* user model at all and
 * therefore returns `false` for every correct password, so no one can ever sign in.
 * It also supplies `getAuthId()` / `getAuthPassword()` and the `rememberToken` column.
 *
 * `EmailVerification` adds the `emailVerifiedAt` column and the signed, single-use
 * verification links (`createEmailVerificationToken()` / `verifyEmailToken()`).
 *
 * `Notifiable` lets a user be sent mail: `user.notify(new VerifyEmailNotification(url))`.
 */
@table("users")
export class User extends Model.using(Authenticatable, EmailVerification, Notifiable) {
  // Models guard every attribute by default. Only these may be mass-assigned
  // from a request body — `role` is deliberately absent, so no amount of extra
  // fields in a form post can promote the account that submitted it.
  static override fillable = ["name", "email", "password"];

  // Never serialised into a rendered page or a JSON response. Every page receives the
  // signed-in user as a prop, so anything secret about them belongs on this list.
  static override hidden = ["password", "rememberToken", "twoFactorSecret", "twoFactorRecoveryCodes"];

  @column({ type: "string" }) name!: string;
  @column({ type: "string" }) email!: string;
  @column({ type: "string" }) password!: string;
  @column({ type: "string", nullable: true, default: "user" }) role?: string | undefined;

  // Two-factor authentication. `Auth.login()` reads these by name: a user with a
  // secret *and* a confirmed time must pass the challenge before they are signed in.
  @column({ type: "string", nullable: true }) twoFactorSecret?: string | null | undefined;
  /** SHA-256 hashes of the unused recovery codes, as a JSON array. Never the codes. */
  @column({ type: "text", nullable: true }) twoFactorRecoveryCodes?: string | null | undefined;
  @column({ type: "datetime", nullable: true }) twoFactorConfirmedAt?: Date | null | undefined;

  /** True once two-factor is set up *and* its first code was confirmed. */
  hasTwoFactorEnabled(): boolean {
    return Boolean(this.twoFactorSecret) && this.twoFactorConfirmedAt != null;
  }

  /** The hashes of the recovery codes that are still unused. */
  recoveryCodeHashes(): string[] {
    try {
      const parsed: unknown = JSON.parse(this.twoFactorRecoveryCodes ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
    } catch {
      return [];
    }
  }
}
