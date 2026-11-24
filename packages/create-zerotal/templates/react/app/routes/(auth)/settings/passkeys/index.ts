import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Auth, type PasskeyRegistrationResponseJSON } from "zerotal/auth";
import { listPasskeys, passkeys, REGISTRATION_CHALLENGE_KEY } from "@app/auth/passkeys";

// Route names, as `route()` knows them. Set here so they read the same across verbs.
export const meta = { GET: { name: "settings.passkeys" } };

// GET /settings/passkeys
export const GET = async () => {
  return Inertia.render("settings/passkeys", {
    title: "Passkeys",
    passkeys: await listPasskeys(Auth.user().id),
  });
};

// POST /settings/passkeys — the new credential from `navigator.credentials.create()`.
export async function POST(http: HttpContext): Promise<Response> {
  const user = Auth.user();
  const challenge = http.session?.get(REGISTRATION_CHALLENGE_KEY);
  http.session?.forget(REGISTRATION_CHALLENGE_KEY);

  const body = (await http.request.json().catch(() => null)) as {
    name?: string;
    credential?: PasskeyRegistrationResponseJSON;
  } | null;

  if (typeof challenge !== "string" || !body?.credential) {
    return Response.json({ message: "Start again: the request expired." }, { status: 422 });
  }

  const name = (body.name ?? "").trim().slice(0, 60) || "Passkey";
  const result = await passkeys().verifyRegistration(user, body.credential, challenge, http, name);
  if (result === "passkey.invalid") {
    return Response.json({ message: "That passkey could not be verified." }, { status: 422 });
  }

  http.flash("success", `“${name}” was added. You can use it to sign in.`);
  return Response.json({ ok: true });
}
