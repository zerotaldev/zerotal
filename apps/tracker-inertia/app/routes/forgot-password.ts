import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { GuestMiddleware } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { passwordReset } from "@app/auth/passwords";

export const middleware = [GuestMiddleware];

export const GET = async () => {
  return Inertia.render("forgot-password", { title: "Reset your password" });
};

export async function POST(http: HttpContext): Promise<void> {
  const { email } = await validate(http, (r) => ({
    email: r.string().trim().email(),
  }));

  await passwordReset.sendResetLink(email);

  // The same answer whether or not that address has an account — reporting "no
  // such user" would make this form a way to enumerate registered addresses.
  http.flash("success", __("If that address has an account, a reset link is on its way."));
  http.redirect("/forgot-password", 303);
}
