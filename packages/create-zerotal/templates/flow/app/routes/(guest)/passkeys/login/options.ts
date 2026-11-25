import { NotFoundError, type HttpContext } from "zerotal";
import { LOGIN_CHALLENGE_KEY, passkeys, passkeysEnabled } from "@app/auth/passkeys";

// POST /passkeys/login/options — the challenge for `navigator.credentials.get()`.
//
// No account is named: the browser offers whichever passkeys it holds for this site,
// and the one the user picks says who they are.
export async function POST(http: HttpContext): Promise<Response> {
  if (!passkeysEnabled()) throw new NotFoundError();

  const options = await passkeys().authenticationOptions();
  http.session?.set(LOGIN_CHALLENGE_KEY, options.challenge);
  return Response.json(options);
}
