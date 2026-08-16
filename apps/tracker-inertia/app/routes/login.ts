import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Auth, GuestMiddleware } from "zerotal/auth";
import { validate } from "zerotal/validator";

// Signed-in visitors are sent away from the sign-in form rather than shown it.
export const middleware = [GuestMiddleware];

export const GET = async () => {
  return Inertia.render("login", { title: "Sign in" });
};

export async function POST(http: HttpContext): Promise<void> {
  const { email, password, remember } = await validate(http, (r) => ({
    email: r.string().trim().email(),
    password: r.string().min(1),
    remember: r.boolean().optional(),
  }));

  const ok = await Auth.attempt({ email, password }, Boolean(remember));

  if (!ok) {
    // One message for a wrong address and a wrong password alike. Saying which
    // was wrong would turn this form into a way to discover valid accounts.
    http.flash("error", "Those credentials do not match our records.");
    http.redirect("/login", 303);
    return;
  }

  http.flash("success", "Welcome back.");
  http.redirect("/profile", 303);
}
