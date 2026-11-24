/**
 * The browser's half of a passkey ceremony.
 *
 * The server sends WebAuthn options as JSON, with every binary value as base64url text;
 * `navigator.credentials` wants those as bytes, and returns bytes that have to go back
 * as text. These two functions do that conversion around the browser call, by hand,
 * so they work in every browser with passkeys — not only those with the newer
 * `PublicKeyCredential.parse*FromJSON()` helpers.
 */

/** Whether this browser can use passkeys at all. */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

function toBytes(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function toText(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface CredentialDescriptorJSON {
  id: string;
  type: string;
  transports?: string[];
}

function descriptors(list: CredentialDescriptorJSON[] | undefined) {
  return (list ?? []).map((c) => ({
    id: toBytes(c.id),
    type: "public-key" as const,
    ...(c.transports ? { transports: c.transports as AuthenticatorTransport[] } : {}),
  }));
}

/** Make a new passkey from the server's registration options. */
export async function createPasskey(options: {
  challenge: string;
  user: { id: string; name: string; displayName: string };
  excludeCredentials?: CredentialDescriptorJSON[];
  [key: string]: unknown;
}): Promise<unknown> {
  const publicKey = {
    ...options,
    challenge: toBytes(options.challenge),
    user: { ...options.user, id: toBytes(options.user.id) },
    excludeCredentials: descriptors(options.excludeCredentials),
  } as unknown as PublicKeyCredentialCreationOptions;

  const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential;
  const response = credential.response as AuthenticatorAttestationResponse;

  return {
    id: credential.id,
    rawId: toText(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toText(response.clientDataJSON),
      attestationObject: toText(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
  };
}

/** Sign in with a passkey, from the server's authentication options. */
export async function getPasskey(options: {
  challenge: string;
  allowCredentials?: CredentialDescriptorJSON[];
  [key: string]: unknown;
}): Promise<unknown> {
  const publicKey = {
    ...options,
    challenge: toBytes(options.challenge),
    allowCredentials: descriptors(options.allowCredentials),
  } as unknown as PublicKeyCredentialRequestOptions;

  const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential;
  const response = credential.response as AuthenticatorAssertionResponse;

  return {
    id: credential.id,
    rawId: toText(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toText(response.clientDataJSON),
      authenticatorData: toText(response.authenticatorData),
      signature: toText(response.signature),
      userHandle: response.userHandle ? toText(response.userHandle) : undefined,
    },
  };
}

/** The user dismissed the browser's prompt — not an error worth a red toast. */
export function wasCancelled(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError");
}
