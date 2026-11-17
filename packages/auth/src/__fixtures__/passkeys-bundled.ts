/**
 * The entry `passkeys.test.ts` bundles with `Bun.build` and runs, standing in for a compiled app.
 *
 * A bundle orders module start-up differently from the runtime, and the WebAuthn library failed
 * to load in one while loading fine unbundled. Running a ceremony is what loads it, so this runs
 * one and prints the algorithms it offered.
 */
import { PasskeyService } from "../Passkeys.ts";

const service = new PasskeyService({
  rpName: "Fixture",
  rpId: "example.com",
  origin: "https://example.com",
  findUserCredentials: async () => [],
  findCredential: async () => null,
  saveCredential: async () => {},
  updateCounter: async () => {},
});

const options = await service.registrationOptions(
  { id: 1, name: "Fixture", email: "fixture@example.com" },
  [],
);

console.log(JSON.stringify(options.pubKeyCredParams.map((param) => param.alg)));
