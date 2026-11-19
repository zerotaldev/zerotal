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
 * The WebAuthn library is an optional peer. An app that uses passkeys installs it with
 * `bun add @simplewebauthn/server reflect-metadata`; an app that does not installs nothing.
 * It is loaded on the first ceremony, not when `@zerotal/auth` is imported, and a ceremony
 * run without it throws `OptionalPeerMissingError` naming that command. The shapes the
 * ceremonies take and return are declared here rather than imported from the library, so an
 * app without it still type-checks.
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

import type { HttpContext } from "@zerotal/core";
import { optionalPeer } from "@zerotal/core/runtime";
import type { OptionalPeerHint } from "@zerotal/core/runtime";

// -- WebAuthn shapes ----------------------------------------------------------

/**
 * A transport an authenticator says it can be reached over, as the browser reports it.
 *
 * Wider than WebAuthn's own list (`ble`, `hybrid`, `internal`, `nfc`, `usb`): browsers still
 * report `"cable"` and `"smart-card"`, and a stored credential may hold either.
 */
export type PasskeyTransport =
  "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";

/**
 * Whether a credential can leave the authenticator that made it. `"multiDevice"` is a passkey
 * the platform syncs between the user's devices; `"singleDevice"` stays on one authenticator,
 * as on most security keys.
 */
export type PasskeyDeviceType = "singleDevice" | "multiDevice";

/**
 * What {@link PasskeyService.registrationOptions} returns: the options for the browser's
 * `navigator.credentials.create()`, in WebAuthn's JSON form, where every binary value is a
 * base64url string.
 *
 * Send it to the page as it is. `PublicKeyCredential.parseCreationOptionsFromJSON()` turns it
 * into the object `create()` takes, and a browser library that accepts WebAuthn's JSON takes
 * it unchanged. Stash `challenge` for {@link PasskeyService.verifyRegistration}.
 */
export interface PasskeyRegistrationOptionsJSON {
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  /** The value the authenticator signs. Keep it server-side until the response comes back. */
  challenge: string;
  pubKeyCredParams: { alg: number; type: "public-key" }[];
  timeout?: number;
  /** The user's registered credentials, so one authenticator cannot be enrolled twice. */
  excludeCredentials?: { id: string; type: string; transports?: string[] }[];
  authenticatorSelection?: {
    authenticatorAttachment?: "platform" | "cross-platform";
    requireResidentKey?: boolean;
    residentKey?: "discouraged" | "preferred" | "required";
    userVerification?: "discouraged" | "preferred" | "required";
  };
  attestation?: "direct" | "enterprise" | "indirect" | "none";
  hints?: ("hybrid" | "security-key" | "client-device")[];
  extensions?: { credProps?: boolean };
}

/**
 * What {@link PasskeyService.authenticationOptions} returns: the options for the browser's
 * `navigator.credentials.get()`, in WebAuthn's JSON form.
 *
 * `PublicKeyCredential.parseRequestOptionsFromJSON()` turns it into the object `get()` takes.
 * Stash `challenge` for {@link PasskeyService.verifyAuthentication}.
 */
export interface PasskeyAuthenticationOptionsJSON {
  /** The value the authenticator signs. Keep it server-side until the assertion comes back. */
  challenge: string;
  timeout?: number;
  rpId?: string;
  /** The credentials that may answer. Absent or empty, the authenticator offers its own. */
  allowCredentials?: { id: string; type: string; transports?: string[] }[];
  userVerification?: "discouraged" | "preferred" | "required";
}

/**
 * What the browser sends back from `navigator.credentials.create()`: the new credential's
 * `toJSON()`. {@link PasskeyService.verifyRegistration} takes it as it arrives.
 */
export interface PasskeyRegistrationResponseJSON {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    authenticatorData?: string;
    transports?: string[];
    publicKeyAlgorithm?: number;
    publicKey?: string;
  };
  authenticatorAttachment?: "platform" | "cross-platform";
  /** What the browser reports for the extensions it ran. Zerotal reads none of it. */
  clientExtensionResults: object;
  type: "public-key";
}

/**
 * What the browser sends back from `navigator.credentials.get()`: the assertion's `toJSON()`.
 * {@link PasskeyService.verifyAuthentication} takes it as it arrives.
 */
export interface PasskeyAuthenticationResponseJSON {
  /** The credential's id, which `findCredential` is asked for. */
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  authenticatorAttachment?: "platform" | "cross-platform";
  /** What the browser reports for the extensions it ran. Zerotal reads none of it. */
  clientExtensionResults: object;
  type: "public-key";
}

// -- Library loading ----------------------------------------------------------

/**
 * @internal The part of `@simplewebauthn/server` the ceremonies call, with the arguments they
 * pass and the results they read.
 *
 * Described here because the library is an optional peer: a type imported from it would fail
 * the type-check of every app that does not install it. `passkeys.test.ts` holds the real
 * library to this description, so a release that changes what Zerotal relies on fails there.
 */
export interface _WebAuthnLibrary {
  generateRegistrationOptions: (options: {
    rpName: string;
    rpID: string;
    userID: Uint8Array<ArrayBuffer>;
    userName: string;
    userDisplayName: string;
    timeout: number;
    attestationType: "none";
    excludeCredentials: { id: string; transports?: string[] }[];
    authenticatorSelection: {
      residentKey: "preferred";
      userVerification: "required" | "preferred";
      authenticatorAttachment?: "platform" | "cross-platform";
    };
    supportedAlgorithmIDs: number[];
  }) => Promise<PasskeyRegistrationOptionsJSON>;
  verifyRegistrationResponse: (options: {
    response: PasskeyRegistrationResponseJSON;
    expectedChallenge: string;
    expectedOrigin: string | string[];
    expectedRPID: string;
    requireUserVerification: boolean;
    supportedAlgorithmIDs: number[];
  }) => Promise<{
    verified: boolean;
    registrationInfo?:
      | {
          credential: {
            id: string;
            publicKey: Uint8Array;
            counter: number;
            transports?: string[];
          };
          credentialDeviceType: PasskeyDeviceType;
          credentialBackedUp: boolean;
        }
      | undefined;
  }>;
  generateAuthenticationOptions: (options: {
    rpID: string;
    timeout: number;
    allowCredentials: { id: string; transports?: string[] }[];
    userVerification: "required" | "preferred";
  }) => Promise<PasskeyAuthenticationOptionsJSON>;
  verifyAuthenticationResponse: (options: {
    response: PasskeyAuthenticationResponseJSON;
    expectedChallenge: string;
    expectedOrigin: string | string[];
    expectedRPID: string;
    credential: {
      id: string;
      publicKey: Uint8Array<ArrayBuffer>;
      counter: number;
      transports?: string[];
    };
    requireUserVerification: boolean;
  }) => Promise<{ verified: boolean; authenticationInfo: { newCounter: number } }>;
}

/**
 * What a ceremony run without the library reports. Both packages are named in the command,
 * whichever one is missing, because a ceremony needs the two together.
 */
const PEER_HINT: OptionalPeerHint = {
  feature: "PasskeyService",
  install: "bun add @simplewebauthn/server reflect-metadata",
};

/**
 * The WebAuthn library, loaded on the first ceremony rather than when `@zerotal/auth` is
 * imported, so an app that never uses passkeys never loads it, and need not install it.
 *
 * The specifiers are literals on purpose: `bun zt compile` embeds a literal `import()` in the
 * binary, and a specifier held in a variable is left out of it. `as string` keeps an app's
 * type-check from looking for a package it may not have, and `optionalPeer()` turns "not
 * installed" into an `OptionalPeerMissingError` that names the install command.
 *
 * `reflect-metadata` is loaded first, and on its own, for the bundled case. The library's
 * certificate code imports it and then `tsyringe`, which throws at load unless the polyfill has
 * run. In a module graph reached through `import()`, Bun's bundler starts the ES modules before
 * the CommonJS polyfill whatever order the source imports them in, so a compiled app failed on
 * its first ceremony. Loaded ahead of the library, the polyfill is in place before any of it runs.
 */
let _library: Promise<_WebAuthnLibrary> | undefined;

/**
 * @internal Load the WebAuthn library once; a failed load is retried on the next call. The
 * doctor check calls it too, so it reports exactly what a ceremony would meet.
 */
export function _webauthn(): Promise<_WebAuthnLibrary> {
  _library ??= _loadWebAuthn().catch((err: unknown) => {
    _library = undefined;
    throw err;
  });
  return _library;
}

/** @internal The polyfill, then the library; the note on `_library` says why in that order. */
async function _loadWebAuthn(): Promise<_WebAuthnLibrary> {
  await import("reflect-metadata" as string).catch(optionalPeer("reflect-metadata", PEER_HINT));
  return import("@simplewebauthn/server" as string).catch(
    optionalPeer("@simplewebauthn/server", PEER_HINT),
  );
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

export interface PasskeyCredential {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: string;
  counter: number;
  device_type: PasskeyDeviceType;
  backed_up: boolean;
  transports: PasskeyTransport[] | null;
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
  /**
   * Which kind of authenticator registration asks for. Unset, the default, the browser offers
   * both: the device's own (Touch ID, Windows Hello, a phone's screen lock) and a roaming one,
   * such as a USB or NFC security key or a phone reached by QR code.
   *
   * `"platform"` asks for the device's own only, and `"cross-platform"` for a roaming one only.
   * Either shuts out a user whose authenticator is the other kind. It applies to
   * {@link PasskeyService.registrationOptions}; signing in accepts any registered credential.
   */
  authenticatorAttachment?: "platform" | "cross-platform" | undefined;
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
   * @throws `OptionalPeerMissingError` when `@simplewebauthn/server` or `reflect-metadata` is not
   *   installed.
   * @category Registration
   */
  async registrationOptions(
    user: PasskeyUser,
    existingCredentials?: PasskeyCredential[],
  ): Promise<PasskeyRegistrationOptionsJSON> {
    const creds = existingCredentials ?? (await this._opts.findUserCredentials(user.id));
    const attachment = this._opts.authenticatorAttachment;

    const { generateRegistrationOptions } = await _webauthn();
    return generateRegistrationOptions({
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
        ...(attachment ? { authenticatorAttachment: attachment } : {}),
      },
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    });
  }

  /**
   * Verify the browser's registration response against the stashed `challenge`
   * and, on success, persist the new credential via `saveCredential`. If the
   * session is currently anonymous it is regenerated and bound to `user.id`.
   *
   * @param user - The user the credential is being registered to.
   * @param response - The registration response JSON from the browser.
   * @param challenge - The challenge previously issued by {@link registrationOptions}.
   * @param ctx - The request context (used to bind the session).
   * @param credentialName - Optional friendly name stored with the credential.
   * @returns `"passkey.registered"` on success, `"passkey.invalid"` when the response fails
   *   verification.
   * @throws The library's `SimpleWebAuthnError` (code `BAD_ARGUMENT`) when `rpId` or `origin`
   *   is not a value it can compare against.
   * @throws `OptionalPeerMissingError` when `@simplewebauthn/server` or `reflect-metadata` is not
   *   installed.
   * @category Registration
   */
  async verifyRegistration(
    user: PasskeyUser,
    response: PasskeyRegistrationResponseJSON,
    challenge: string,
    ctx: HttpContext,
    credentialName?: string,
  ): Promise<"passkey.registered" | "passkey.invalid"> {
    const { verifyRegistrationResponse } = await _webauthn();
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this._opts.origin,
        expectedRPID: this._opts.rpId,
        requireUserVerification: this._requireUv,
        supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
      });
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
      transports: (credential.transports as PasskeyTransport[] | undefined) ?? null,
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
   * @throws `OptionalPeerMissingError` when `@simplewebauthn/server` or `reflect-metadata` is not
   *   installed.
   * @category Authentication
   */
  async authenticationOptions(userId?: number): Promise<PasskeyAuthenticationOptionsJSON> {
    const allowCredentials = userId
      ? (await this._opts.findUserCredentials(userId)).map((c) => ({
          id: c.credential_id,
          ...(c.transports ? { transports: c.transports } : {}),
        }))
      : [];

    const { generateAuthenticationOptions } = await _webauthn();
    return generateAuthenticationOptions({
      rpID: this._opts.rpId,
      timeout: (this._opts.timeoutSeconds ?? 60) * 1000,
      allowCredentials,
      userVerification: this._requireUv ? "required" : "preferred",
    });
  }

  /**
   * Verify the browser's authentication assertion against the stashed `challenge`.
   * Looks the credential up by id, verifies the signature, advances the stored
   * signature `counter` via `updateCounter` (cloned-authenticator detection), then
   * regenerates the session and binds it to the credential's user.
   *
   * @param assertion - The authentication response JSON from the browser.
   * @param challenge - The challenge previously issued by {@link authenticationOptions}.
   * @param ctx - The request context (used to bind the session).
   * @returns `{ credential, userId }` of the signed-in user on success, or
   *   `"passkey.invalid"` when the credential is unknown or verification fails.
   * @throws The library's `SimpleWebAuthnError` (code `BAD_ARGUMENT`) when `rpId` or `origin`
   *   is not a value it can compare against.
   * @throws `OptionalPeerMissingError` when `@simplewebauthn/server` or `reflect-metadata` is not
   *   installed.
   * @category Authentication
   */
  async verifyAuthentication(
    assertion: PasskeyAuthenticationResponseJSON,
    challenge: string,
    ctx: HttpContext,
  ): Promise<{ credential: PasskeyCredential; userId: number } | "passkey.invalid"> {
    const stored = await this._opts.findCredential(assertion.id);
    if (!stored) return "passkey.invalid";

    const { verifyAuthenticationResponse } = await _webauthn();
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
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
      });
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
