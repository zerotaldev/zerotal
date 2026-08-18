import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { GuestMiddleware } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { passwordReset } from "@app/auth/passwords";

export const middleware = [GuestMiddleware];

// The token and address arrive on the query string of the emailed link and are
// handed to the page, which posts them back with the new password.
export const GET = async (http: HttpContext) => {
  const url = new URL(http.request.url);
  return Inertia.render("reset-password", {
    title: "Choose a new password",
    token: url.searchParams.get("token") ?? "",
    email: url.searchParams.get("email") ?? "",
  });
};

export async function POST(http: HttpContext): Promise<void> {
  const { email, token, password } = await validate(http, (r) => ({
    email: r.string().trim().email(),
    token: r.string().min(1),
    // The match is checked on the confirmation, not on the password.
    // `confirmed()` here files the mismatch under `password`, so it rendered
    // beneath the Password box while the Confirm box — which already has an
    // error slot wired up in the form — could never show anything at all.
    password: r.string().min(8),
    password_confirmation: r.string().sameAs("password"),
  }));

  const ok = await passwordReset.reset({ email, token, password });

  if (!ok) {
    http.flash("error", __("This reset link is invalid or has expired."));
    http.redirect(`/reset-password?token=${token}&email=${encodeURIComponent(email)}`, 303);
    return;
  }

  http.flash("success", __("Your password has been updated. Sign in with it below."));
  http.redirect("/login", 303);
}
