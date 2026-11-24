import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Auth, Hash } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { listSessions, revokeOtherSessions } from "@app/auth/sessions";
import { rejectInput } from "@app/support/validation";

// Route names, as `route()` knows them. Set here so they read the same across verbs.
export const meta = { DELETE: { name: "settings.sessions.destroy" } };

// GET /settings/sessions — every browser this account is signed in on.
export const GET = async (http: HttpContext) => {
  return Inertia.render("settings/sessions", {
    title: "Sessions",
    sessions: await listSessions(http, Auth.user().id),
  });
};

// DELETE /settings/sessions — sign out everywhere but here.
export async function DELETE(http: HttpContext): Promise<void> {
  const user = Auth.user();
  const { password } = await validate(http, (r) => ({ password: r.string().min(1) }));

  if (!(await Hash.check(password, user.password))) {
    rejectInput(http, { password: "That password is not correct." }, "/settings/sessions");
  }

  const count = await revokeOtherSessions(http, user.id);

  // A "keep me signed in" cookie on another device would otherwise sign it straight
  // back in. Clearing the token makes every such cookie worthless — this browser's
  // included, though its session carries on.
  user.setRememberToken(null);
  await user.save();

  http.flash(
    "success",
    count === 0
      ? "No other sessions were signed in."
      : `Signed out of ${count} other session${count === 1 ? "" : "s"}.`,
  );
  http.redirect("/settings/sessions", 303);
}
