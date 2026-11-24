import { NotFoundError, type HttpContext } from "zerotal";
import type { PasskeyAuthenticationResponseJSON } from "zerotal/auth";
import { LOGIN_CHALLENGE_KEY, passkeys, passkeysEnabled } from "@app/auth/passkeys";
import { intendedUrl } from "@app/support/redirects";

// POST /passkeys/login — the signed assertion from `navigator.credentials.get()`.
//
// A passkey checks the person (fingerprint, face, PIN) as well as the device, so it
// stands in for both the password and the two-factor code.
export async function POST(http: HttpContext): Promise<Response> {
  if (!passkeysEnabled()) throw new NotFoundError();

  const challenge = http.session?.get(LOGIN_CHALLENGE_KEY);
  http.session?.forget(LOGIN_CHALLENGE_KEY);
  const assertion = (await http.request.json().catch(() => null)) as
    | PasskeyAuthenticationResponseJSON
    | null;

  if (typeof challenge !== "string" || !assertion) {
    return Response.json({ message: "Start again: the sign-in request expired." }, { status: 422 });
  }

  // On success the service rotates the session id and signs the passkey's owner in.
  const result = await passkeys().verifyAuthentication(assertion, challenge, http);
  if (result === "passkey.invalid") {
    return Response.json({ message: "That passkey was not recognised." }, { status: 422 });
  }

  return Response.json({ redirect: intendedUrl(http) });
}
