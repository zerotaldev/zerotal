/**
 * PasskeyService -- WebAuthn (FIDO2) registration and authentication ceremonies.
 *
 * Wraps `@simplewebauthn/server` with a Zerotal-friendly API. Credential
 * storage is handled by the callbacks you supply in {@link PasskeysOptions},
 * so this class is persistence-agnostic.
 *
 * @remarks
 * Each ceremony is two calls: an `*Options` method that produces the challenge to
 * send the browser, and a `verify*` method that checks the browser's response
 * against the challenge you stashed (typically in the session). On successful
 * verification the stored credential's signature `counter` is advanced (cloned-
 * authenticator detection) and the session is regenerated and bound to the user.
 * Verification failures are returned as the string `"passkey.invalid"` rather than
 * thrown — the underlying library errors are caught internally.
 *
 * @example
 * ```ts
 * const passkeys = new PasskeyService({
 *   rpName: "My App", rpId: "example.com", origin: "https://example.com",
 *   findUserCredentials, findCredential, saveCredential, updateCounter,
 * });
 *
 * // Registration: send options, stash options.challenge, then verify the response.
 * const options = await passkeys.registrationOptions(user);
 * const result  = await passkeys.verifyRegistration(user, response, options.challenge, ctx);
 * if (result === "passkey.registered") { ... }
 *
 * // Authentication: send options, stash the challenge, then verify the assertion.
 * const authOpts = await passkeys.authenticationOptions();
 * const auth     = await passkeys.verifyAuthentication(assertion, authOpts.challenge, ctx);
 * if (auth !== "passkey.invalid") { ... }   // auth.userId is now signed in
 * ```
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  GenerateRegistrationOptionsOpts,
  VerifyRegistrationResponseOpts,
  GenerateAuthenticationOptionsOpts,
  VerifyAuthenticationResponseOpts,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  CredentialDeviceType,
} from "@simplewebauthn/server";
import type { HttpContext } from "@zerotal/core";

// -- Stored credential shape --------------------------------------------------

export interface PasskeyCredential {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: string;
  counter: number;
  device_type: CredentialDeviceType;
  backed_up: boolean;
  transports: AuthenticatorTransportFuture[] | null;
  name: string | null;
}

// -- User shape ---------------------------------------------------------------

export interface PasskeyUser {
  id: number;
  name: string;
  email: string;
}

// -- Options ------------------------------------------------------------------

export interface PasskeysOptions {
  rpName: string;
  rpId: string;
  origin: string | string[];
  timeoutSeconds?: number | undefined;
  /**
   * Require the authenticator to verify the *user* — a PIN, a biometric, or an unlock —
   * rather than merely to be present. Defaults to `true`.
   *
   * This is what makes a passkey multi-factor. With verification off, an assertion succeeds
   * on possession of an unlocked authenticator alone: whoever picks up the phone or laptop
   * is the user, and the passkey is one factor, not two. Both ceremonies request
   * `userVerification: "required"` and both verifications reject `uv=0`.
   *
   * Set `false` only for a deliberate single-factor "device is the credential" flow, and
   * then do not count the passkey as a second factor.
   */
  requireUserVerification?: boolean | undefined;
  findUserCredentials(userId: number): Promise<PasskeyCredential[]>;
  findCredential(credentialId: string): Promise<PasskeyCredential | null | undefined>;
  saveCredential(credential: Omit<PasskeyCredential, "id">): Promise<void>;
  updateCounter(id: number, newCounter: number): Promise<void>;
}

// -- PasskeyService -----------------------------------------------------------

export class PasskeyService {
  private readonly _opts: PasskeysOptions;

  constructor(opts: PasskeysOptions) {
    this._opts = opts;
  }

  /** Whether both ceremonies demand `uv=1`. See {@link PasskeysOptions.requireUserVerification}. */
  private get _requireUv(): boolean {
    return this._opts.requireUserVerification ?? true;
  }

  // -- Registration -----------------------------------------------------------

  /**
   * Produce the WebAuthn registration options (challenge) to send the browser's
   * `navigator.credentials.create()`. Already-registered credentials are excluded
   * so the same authenticator can't be enrolled twice. Persist the returned
   * `challenge` (e.g. in the session) to hand back to {@link verifyRegistration}.
   *
   * @param user - The user enrolling a passkey.
   * @param existingCredentials - Optional pre-loaded credentials; otherwise fetched
   *   via `findUserCredentials`.
   * @returns The registration options JSON, including the `challenge`.
   * @category Registration
   */
  async registrationOptions(
    user: PasskeyUser,
    existingCredentials?: PasskeyCredential[],
  ): Promise<Awaited<ReturnType<typeof generateRegistrationOptions>>> {
    const creds = existingCredentials ?? (await this._opts.findUserCredentials(user.id));

    const opts: GenerateRegistrationOptionsOpts = {
      rpName: this._opts.rpName,
      rpID: this._opts.rpId,
      userID: new TextEncoder().encode(String(user.id)),
      userName: user.email,
      userDisplayName: user.name,
      timeout: (this._opts.timeoutSeconds ?? 60) * 1000,
      attestationType: "none",
      excludeCredentials: creds.map((c) => ({
        id: c.credential_id,
        ...(c.transports ? { transports: c.transports } : {}),
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: this._requireUv ? "required" : "preferred",
        authenticatorAttachment: "platform",
      },
    };

    return generateRegistrationOptions(opts);
  }

  /**
   * Verify the browser's registration response against the stashed `challenge`
   * and, on success, persist the new credential via `saveCredential`. If the
   * session is currently anonymous it is regenerated and bound to `user.id`.
   *
   * @param user - The user the credential is being registered to.
   * @param response - The `RegistrationResponseJSON` from the browser.
   * @param challenge - The challenge previously issued by {@link registrationOptions}.
   * @param ctx - The request context (used to bind the session).
   * @param credentialName - Optional friendly name stored with the credential.
   * @returns `"passkey.registered"` on success, `"passkey.invalid"` on any failure.
   * @category Registration
   */
  async verifyRegistration(
    user: PasskeyUser,
    response: RegistrationResponseJSON,
    challenge: string,
    ctx: HttpContext,
    credentialName?: string,
  ): Promise<"passkey.registered" | "passkey.invalid"> {
    const opts: VerifyRegistrationResponseOpts = {
      response,
      expectedChallenge: challenge,
      expectedOrigin: this._opts.origin,
      expectedRPID: this._opts.rpId,
      requireUserVerification: this._requireUv,
    };

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse(opts);
    } catch {
      return "passkey.invalid";
    }

    if (!verification.verified || !verification.registrationInfo) {
      return "passkey.invalid";
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    await this._opts.saveCredential({
      user_id: user.id,
      credential_id: credential.id,
      public_key: _base64url(credential.publicKey),
      counter: credential.counter,
      device_type: credentialDeviceType,
      backed_up: credentialBackedUp,
      transports: (credential.transports as AuthenticatorTransportFuture[]) ?? null,
      name: credentialName ?? null,
    });

    const session = _getSession(ctx);
    if (session && !session.get("user_id")) {
      session.regenerate?.();
      session.set("user_id", user.id);
    }

    return "passkey.registered";
  }

  // -- Authentication ---------------------------------------------------------

  /**
   * Produce the WebAuthn authentication options (challenge) to send the browser's
   * `navigator.credentials.get()`. Pass a `userId` to restrict the assertion to
   * that user's registered credentials; omit it for a usernameless/discoverable
   * login. Persist the returned `challenge` for {@link verifyAuthentication}.
   *
   * @param userId - Optional user id to scope `allowCredentials`.
   * @returns The authentication options JSON, including the `challenge`.
   * @category Authentication
   */
  async authenticationOptions(
    userId?: number,
  ): Promise<Awaited<ReturnType<typeof generateAuthenticationOptions>>> {
    const allowCredentials = userId
      ? (await this._opts.findUserCredentials(userId)).map((c) => ({
          id: c.credential_id,
          ...(c.transports ? { transports: c.transports } : {}),
        }))
      : [];

    const opts: GenerateAuthenticationOptionsOpts = {
      rpID: this._opts.rpId,
      timeout: (this._opts.timeoutSeconds ?? 60) * 1000,
      allowCredentials,
      userVerification: this._requireUv ? "required" : "preferred",
    };

    return generateAuthenticationOptions(opts);
  }

  /**
   * Verify the browser's authentication assertion against the stashed `challenge`.
   * Looks the credential up by id, verifies the signature, advances the stored
   * signature `counter` via `updateCounter` (cloned-authenticator detection), then
   * regenerates the session and binds it to the credential's user.
   *
   * @param assertion - The `AuthenticationResponseJSON` from the browser.
   * @param challenge - The challenge previously issued by {@link authenticationOptions}.
   * @param ctx - The request context (used to bind the session).
   * @returns `{ credential, userId }` of the signed-in user on success, or
   *   `"passkey.invalid"` when the credential is unknown or verification fails.
   * @category Authentication
   */
  async verifyAuthentication(
    assertion: AuthenticationResponseJSON,
    challenge: string,
    ctx: HttpContext,
  ): Promise<{ credential: PasskeyCredential; userId: number } | "passkey.invalid"> {
    const stored = await this._opts.findCredential(assertion.id);
    if (!stored) return "passkey.invalid";

    const opts: VerifyAuthenticationResponseOpts = {
      response: assertion,
      expectedChallenge: challenge,
      expectedOrigin: this._opts.origin,
      expectedRPID: this._opts.rpId,
      credential: {
        id: stored.credential_id,
        publicKey: _fromBase64url(stored.public_key),
        counter: stored.counter,
        ...(stored.transports ? { transports: stored.transports } : {}),
      },
      requireUserVerification: this._requireUv,
    };

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse(opts);
    } catch {
      return "passkey.invalid";
    }

    if (!verification.verified) return "passkey.invalid";

    await this._opts.updateCounter(stored.id, verification.authenticationInfo.newCounter);

    const session = _getSession(ctx);
    if (session) {
      session.regenerate?.();
      session.set("user_id", stored.user_id);
    }

    return { credential: stored, userId: stored.user_id };
  }
}

// -- Internal helpers ---------------------------------------------------------

type SessionLike = {
  get(k: string): unknown;
  set(k: string, v: unknown): void;
  regenerate?(): void;
};

/** @internal Extract the session (if any) from the request context. */
function _getSession(ctx: HttpContext): SessionLike | undefined {
  return (ctx as unknown as { session?: SessionLike }).session;
}

/** @internal Base64url-encode a credential public key for storage. */
function _base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** @internal Decode a stored base64url public key back to bytes. */
function _fromBase64url(str: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(str, "base64url"));
}
