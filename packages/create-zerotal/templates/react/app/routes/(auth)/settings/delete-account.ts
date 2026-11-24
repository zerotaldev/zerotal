import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Auth, Hash } from "zerotal/auth";
import { DB } from "zerotal/orm";
import { validate } from "zerotal/validator";
import { forgetAllSessions } from "@app/auth/sessions";
import { rejectInput } from "@app/support/validation";

// Route names, as `route()` knows them. Set here so they read the same across verbs.
export const meta = { DELETE: { name: "settings.delete-account.destroy" } };

// GET /settings/delete-account
export const GET = async () => {
  return Inertia.render("settings/delete-account", { title: "Delete account" });
};

// DELETE /settings/delete-account — permanent, and asks for the password first.
export async function DELETE(http: HttpContext): Promise<void> {
  const user = Auth.user();
  const { password } = await validate(http, (r) => ({ password: r.string().min(1) }));

  if (!(await Hash.check(password, user.password))) {
    rejectInput(http, { password: "That password is not correct." }, "/settings/delete-account");
  }

  // Signed out first: signing out writes to the user row (it clears the remember token),
  // so it has to happen while the row still exists.
  await Auth.logout();

  // Everything that belongs to the account goes with it — add your own tables here. The
  // user row goes last, so a failure part-way leaves an account that can try again
  // rather than rows that belong to nobody.
  await DB.table("projects").where("user_id", user.id).delete();
  await DB.table("passkeys").where("user_id", user.id).delete();
  await DB.table("social_accounts").where("user_id", user.id).delete();
  await forgetAllSessions(user.id);
  await user.delete();

  http.flash("success", "Your account has been deleted.");
  http.redirect("/", 303);
}
