/**
 * Drives `PasskeyService` against the real `@simplewebauthn/server`, in a process of its own.
 *
 * `passkeys.test.ts` mocks the library for the whole test process, so what only the real one can
 * show runs here and is printed as one JSON line for the test to read: whether importing
 * `@zerotal/auth` loads the library, how a misconfigured service and a mismatched response
 * come back from each verification, and what registration asks the browser for.
 */
const loaded = (): number =>
  Object.keys(require.cache).filter((key) => key.includes("simplewebauthn")).length;

const { PasskeyService } = await import("../index.ts");

const loadedOnImport = loaded();

const CHALLENGE = "fixture-challenge";

/** A response that gets past the id, type and challenge checks, so the origin is compared. */
function response(type: "webauthn.create" | "webauthn.get", origin: string) {
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type, challenge: CHALLENGE, origin }),
  ).toString("base64url");
  return {
    id: "Y3JlZA",
    rawId: "Y3JlZA",
    type: "public-key",
    clientExtensionResults: {},
    response: { clientDataJSON, attestationObject: "", authenticatorData: "", signature: "" },
  } as never;
}

function service(origin: string) {
  return new PasskeyService({
    rpName: "Fixture",
    rpId: "example.com",
    origin,
    findUserCredentials: async () => [],
    findCredential: async () => ({
      id: 1,
      user_id: 1,
      credential_id: "Y3JlZA",
      public_key: Buffer.from([1, 2, 3]).toString("base64url"),
      counter: 0,
      device_type: "singleDevice",
      backed_up: false,
      transports: null,
      name: null,
    }),
    saveCredential: async () => {},
    updateCounter: async () => {},
  });
}

/** What a call settled to: its value, or the thrown error's name and code. */
async function outcome(run: () => Promise<unknown>): Promise<unknown> {
  try {
    const value = await run();
    return typeof value === "string" ? value : "resolved";
  } catch (err) {
    const e = err as { name?: string; code?: string };
    return { threw: e.name, code: e.code };
  }
}

const user = { id: 1, name: "Fixture", email: "fixture@example.com" };
const ctx = {} as never;
const MISCONFIGURED = "https://example.com/";

const registrationOptions = await service("https://example.com").registrationOptions(user, []);

const result = {
  loadedOnImport,
  registration: {
    misconfigured: await outcome(() =>
      service(MISCONFIGURED).verifyRegistration(
        user,
        response("webauthn.create", "https://example.com"),
        CHALLENGE,
        ctx,
      ),
    ),
    wrongOrigin: await outcome(() =>
      service("https://example.com").verifyRegistration(
        user,
        response("webauthn.create", "https://evil.test"),
        CHALLENGE,
        ctx,
      ),
    ),
  },
  authentication: {
    misconfigured: await outcome(() =>
      service(MISCONFIGURED).verifyAuthentication(
        response("webauthn.get", "https://example.com"),
        CHALLENGE,
        ctx,
      ),
    ),
    wrongOrigin: await outcome(() =>
      service("https://example.com").verifyAuthentication(
        response("webauthn.get", "https://evil.test"),
        CHALLENGE,
        ctx,
      ),
    ),
  },
  algorithms: registrationOptions.pubKeyCredParams.map((param) => param.alg),
  authenticatorSelection: registrationOptions.authenticatorSelection,
  loadedAfterCeremony: loaded() > 0,
};

console.log(JSON.stringify(result));

export {};
