// -- Result constants ----------------------------------------------------------

/**
 * Typed result constants returned by {@link MagicLinkBroker}.
 *
 * @example
 * ```ts
 * import { MagicLinkBroker, MAGIC } from '@zerotal/auth';
 *
 * const result = await magicLinks.sendLink(email);
 * if (result === MAGIC.SENT) { ... }
 * if (result === MAGIC.USER_NOT_FOUND) { ... }
 * ```
 */
export const MAGIC = {
  /** Magic link sent successfully. */
  SENT: "magic.sent",
  /** No user found for the given email. */
  USER_NOT_FOUND: "magic.user_not_found",
  /** Login succeeded. */
  OK: "magic.ok",
  /** Link signature invalid or user not found during login. */
  INVALID: "magic.invalid",
} as const;

export type MagicLinkBrokerResult = (typeof MAGIC)[keyof typeof MAGIC];

// -----------------------------------------------------------------------------

import { type HttpContext } from "@zerotal/core";
import { Url } from "@zerotal/core/http";

export interface MagicLinkUser {
  id: number;
}

export interface MagicLinkBrokerOptions<U extends MagicLinkUser = MagicLinkUser> {
  /** App secret used to sign links -- use the same value as session.secret / APP_KEY. */
  secret: string;
  /** The absolute URL the signed link will point to (your verify endpoint). */
  verifyUrl: string;
  /** Minutes until the link expires. Default: 15. */
  expiresInMinutes?: number | undefined;
  findUser(email: string): Promise<U | null | undefined>;
  sendLink(email: string, signedUrl: string): Promise<void>;
}

/**
 * Passwordless "magic link" login broker.
 *
 * @remarks
 * {@link sendLink} mints a signed, expiring URL (via `Url.sign`, keyed by
 * `secret`) that embeds the target email and points at your verify endpoint, then
 * hands it to your `sendLink` callback to deliver. Guard that endpoint with
 * {@link ValidateSignatureMiddleware} so a tampered or expired link is rejected
 * before your handler runs; call {@link login} once the signature is confirmed to
 * regenerate the session and sign the user in. The signature carries no server-side
 * state, so it is not single-use on its own — it stays valid until it expires.
 *
 * @example
 * ```ts
 * const magicLinks = new MagicLinkBroker({
 *   secret: config("app.key"),
 *   verifyUrl: "https://example.com/auth/magic/verify",
 *   findUser: (email) => User.query().where("email", email).first(),
 *   sendLink: (email, url) => Mail.to(email).send(new MagicLink(url)),
 * });
 *
 * await magicLinks.sendLink("a@b.com");     // MAGIC.SENT or MAGIC.USER_NOT_FOUND
 * // …at the (signature-validated) verify endpoint:
 * await magicLinks.login("a@b.com", ctx);   // MAGIC.OK or MAGIC.INVALID
 * ```
 */
export class MagicLinkBroker<U extends MagicLinkUser = MagicLinkUser> {
  private readonly _opts: MagicLinkBrokerOptions<U>;

  constructor(opts: MagicLinkBrokerOptions<U>) {
    this._opts = opts;
  }

  /**
   * Generate a signed magic link and send it to the user.
   *
   * @param email - The address to look up and deliver the link to.
   * @returns `MAGIC.SENT` on success, `MAGIC.USER_NOT_FOUND` if no user exists.
   */
  async sendLink(email: string): Promise<"magic.sent" | "magic.user_not_found"> {
    const user = await this._opts.findUser(email);
    if (!user) return "magic.user_not_found";

    const url = Url.sign(
      this._opts.verifyUrl,
      { email },
      this._opts.expiresInMinutes ?? 15,
      this._opts.secret,
    );

    await this._opts.sendLink(email, url);
    return "magic.sent";
  }

  /**
   * Establish a session for the link's email, regenerating the session id first.
   *
   * @remarks
   * Assumes the URL signature has already been validated (e.g. by
   * {@link ValidateSignatureMiddleware}); this method only re-checks that the user
   * still exists and then seeds the session.
   *
   * @param email - The email carried by the (validated) signed link.
   * @param ctx - The request context whose session is regenerated and populated.
   * @returns `MAGIC.OK` on success, `MAGIC.INVALID` if the user no longer exists.
   */
  async login(email: string, ctx: HttpContext): Promise<"magic.ok" | "magic.invalid"> {
    const user = await this._opts.findUser(email);
    if (!user) return "magic.invalid";

    const session = (
      ctx as unknown as { session?: { set(k: string, v: unknown): void; regenerate(): void } }
    ).session;
    if (session) {
      session.regenerate();
      session.set("user_id", user.id);
    }

    return "magic.ok";
  }

  /**
   * Manually verify a signed URL string (without middleware).
   *
   * @param signedUrl - The full signed URL to check.
   * @returns `true` when the signature is intact and unexpired.
   */
  verify(signedUrl: string): boolean {
    return Url.verify(signedUrl, this._opts.secret);
  }
}
