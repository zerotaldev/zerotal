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
 * thrown. A misconfigured service is thrown instead: an `rpId` or `origin` the library
 * cannot compare against fails every ceremony, and that is not the browser's fault.
 *
 * `@simplewebauthn/server` is loaded on the first ceremony, not when `@zerotal/auth` is
 * imported, so an app that never uses passkeys never loads it.
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

import type {
  GenerateRegistrationOptionsOpts,
  VerifyRegistrationResponseOpts,
  GenerateAuthenticationOptionsOpts,
  VerifyAuthenticationResponseOpts,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  CredentialDeviceType,
} from "@simplewebauthn/server";
import type { HttpContext } from "@zerotal/core";

// -- Library loading ----------------------------------------------------------

/**
 * The WebAuthn library, loaded on the first ceremony rather than when `@zerotal/auth` is
 * imported, so an app that never uses passkeys never loads it.
 *
 * The specifiers are literals on purpose: `bun zt compile` embeds a literal `import()` in the
 * binary, and a specifier held in a variable is left out of it.
 *
 * `reflect-metadata` is loaded first, and on its own, for the bundled case. The library's
 * certificate code imports it and then `tsyringe`, which throws at load unless the polyfill has
 * run. In a module graph reached through `import()`, Bun's bundler starts the ES modules before
 * the CommonJS polyfill whatever order the source imports them in, so a compiled app failed on
 * its first ceremony. Loaded ahead of the library, the polyfill is in place before any of it runs.
 */
let _library: Promise<typeof import("@simplewebauthn/server")> | undefined;

/** @internal Load the WebAuthn library once; a failed load is retried on the next call. */
function _webauthn(): Promise<typeof import("@simplewebauthn/server")> {
  _library ??= import("reflect-metadata")
    .then(() => import("@simplewebauthn/server"))
    .catch((err: unknown) => {
      _library = undefined;
      throw err;
    });
  return _library;
}

/**
 * The public-key algorithms offered at registration and accepted when it is verified, as COSE
 * identifiers, most preferred first: EdDSA (-8), ES256 (-7), RS256 (-257).
 *
 * Fixed here rather than left to the library's default, which since 14.0 adds ML-DSA-44 on
 * runtimes whose WebCrypto supports it. Which algorithms an app accepts should not depend on the
 * runtime it happens to be deployed on, and a key registered there could not be verified after a
 * move to one without it.
 */
const SUPPORTED_ALGORITHM_IDS: number[] = [-8, -7, -257];

/**
 * @internal Whether a library error means the service is configured wrongly rather than that the
 * browser's response failed verification. The library raises `BAD_ARGUMENT` for an `rpId` or
 * `origin` it cannot compare against, such as a non-ASCII domain or an origin ending in `/`.
 */
function _isConfigurationError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.name === "SimpleWebAuthnError" &&
    (err as Error & { code?: unknown }).code === "BAD_ARGUMENT"
  );
}

// -- Stored credential shape --------------------------------------------------

/**
 * A transport an authenticator says it can be reached over, as the browser reports it.
 *
 * Declared here since `@simplewebauthn/server` 14 dropped its type of this name. Its
 * replacement leaves out `"cable"` and `"smart-card"`, which browsers still report and stored
 * credentials may hold, so the list a {@link PasskeyCredential} can carry is unchanged.
 */
type AuthenticatorTransportFuture =
  "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";

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
  ): Promise<
    Awaited<ReturnType<typeof import("@simplewebauthn/server").generateRegistrationOptions>>
  > {
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
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    };

    const { generateRegistrationOptions } = await _webauthn();
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
   * @returns `"passkey.registered"` on success, `"passkey.invalid"` when the response fails
   *   verification.
   * @throws The library's `SimpleWebAuthnError` (code `BAD_ARGUMENT`) when `rpId` or `origin`
   *   is not a value it can compare against.
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
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    };

    const { verifyRegistrationResponse } = await _webauthn();
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse(opts);
    } catch (err) {
      if (_isConfigurationError(err)) throw err;
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
  ): Promise<
    Awaited<ReturnType<typeof import("@simplewebauthn/server").generateAuthenticationOptions>>
  > {
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

    const { generateAuthenticationOptions } = await _webauthn();
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
   * @throws The library's `SimpleWebAuthnError` (code `BAD_ARGUMENT`) when `rpId` or `origin`
   *   is not a value it can compare against.
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

    const { verifyAuthenticationResponse } = await _webauthn();
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse(opts);
    } catch (err) {
      if (_isConfigurationError(err)) throw err;
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
