import type { HttpContext } from "zerotal";
import { Auth } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { User } from "@app/models/User";
import { VerifyEmailNotification } from "@app/notifications/VerifyEmailNotification";
import { rejectInput } from "@app/support/validation";

// Route names, as `route()` knows them. Set here so they read the same across verbs.
export const meta = { PATCH: { name: "settings.profile.update" } };

// PATCH /settings/profile — name and email.
export async function PATCH(http: HttpContext): Promise<void> {
  const user = Auth.user();

  const { name, email } = await validate(http, (r) => ({
    name: r.string().trim().min(2).max(80),
    email: r.string().trim().email(),
  }));

  // Someone else holding this address is the only conflict — keeping your own is not
  // a change at all.
  const taken = await User.query().where("email", email).first();
  if (taken && taken.id !== user.id) {
    rejectInput(http, { email: "That email is already in use." }, "/settings/profile");
  }

  const emailChanged = email !== user.email;
  user.name = name;
  user.email = email;
  // A new address is unproven until its own link is clicked. Outstanding links for the
  // old address stop working on their own: each one names the address it was sent to.
  if (emailChanged) user.emailVerifiedAt = null;
  await user.save();

  if (emailChanged) {
    await user.notify(new VerifyEmailNotification(user.createEmailVerificationToken()));
    http.flash("success", `Saved. We sent a link to ${email} to confirm it.`);
  } else {
    http.flash("success", "Profile saved.");
  }
  http.redirect("/settings/profile", 303);
}
