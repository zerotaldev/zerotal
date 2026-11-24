import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Auth } from "zerotal/auth";
import { VerifyEmailNotification } from "@app/notifications/VerifyEmailNotification";

// GET /verify-email — "check your inbox", until the link has been clicked.
export const GET = async (http: HttpContext) => {
  const user = Auth.user();
  if (user.hasVerifiedEmail()) {
    http.redirect("/dashboard", 302);
    return;
  }
  return Inertia.render("auth/verify-email", { title: "Verify your email", email: user.email });
};

// POST /verify-email — send the link again.
export async function POST(http: HttpContext): Promise<void> {
  const user = Auth.user();
  if (user.hasVerifiedEmail()) {
    http.redirect("/dashboard", 303);
    return;
  }

  await user.notify(new VerifyEmailNotification(user.createEmailVerificationToken()));

  http.flash("success", `A new link is on its way to ${user.email}.`);
  http.redirect("/verify-email", 303);
}
