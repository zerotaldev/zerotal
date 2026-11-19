/**
 * The entry `passkeys.test.ts` bundles with the WebAuthn library left out, and runs from a
 * directory with nothing installed: an app that never added the optional peer.
 *
 * It loads the whole of `@zerotal/auth`, as an app does, and uses a part that has nothing to do
 * with passkeys, which has to work. Then it runs a ceremony, which has to fail with the error
 * that says what to install, and the doctor check, run where the test put a file that uses
 * passkeys. It prints one JSON line for the test to read.
 */
import { OptionalPeerMissingError } from "@zerotal/core/runtime";
import { PasskeyService, hashToken } from "../index.ts";
import { passkeyLibraryCheck } from "../passkeysDoctor.ts";

const hashed = await hashToken("fixture-token");

const service = new PasskeyService({
  rpName: "Fixture",
  rpId: "example.com",
  origin: "https://example.com",
  findUserCredentials: async () => [],
  findCredential: async () => null,
  saveCredential: async () => {},
  updateCounter: async () => {},
});

/** What the ceremony settled to: the options it produced, or the error it threw. */
async function ceremony(): Promise<unknown> {
  try {
    await service.registrationOptions({ id: 1, name: "Fixture", email: "fixture@example.com" }, []);
    return "resolved";
  } catch (err) {
    if (!(err instanceof OptionalPeerMissingError)) {
      return { threw: (err as Error).name, message: (err as Error).message };
    }
    return { threw: err.name, code: err.code, missing: err.missing, message: err.message };
  }
}

const result = { hashedLength: hashed.length, ceremony: await ceremony() };
const doctor = await passkeyLibraryCheck.run({} as never);

console.log(JSON.stringify({ ...result, doctor }));
