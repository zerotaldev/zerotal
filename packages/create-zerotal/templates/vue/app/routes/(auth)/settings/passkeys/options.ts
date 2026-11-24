import type { HttpContext } from "zerotal";
import { Auth } from "zerotal/auth";
import { passkeys, REGISTRATION_CHALLENGE_KEY } from "@app/auth/passkeys";

// POST /settings/passkeys/options — the challenge for `navigator.credentials.create()`.
// Passkeys the user already has are excluded, so one device is not enrolled twice.
export async function POST(http: HttpContext): Promise<Response> {
  const options = await passkeys().registrationOptions(Auth.user());
  http.session?.set(REGISTRATION_CHALLENGE_KEY, options.challenge);
  return Response.json(options);
}
