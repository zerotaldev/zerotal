import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Auth, Hash } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { User } from "@app/models/User";
import { socialProviders } from "@app/auth/social";
import { VerifyEmailNotification } from "@app/notifications/VerifyEmailNotification";
import { rejectInput } from "@app/support/validation";

// GET /register
export const GET = async () => {
  return Inertia.render("auth/register", {
    title: "Create an account",
    providers: socialProviders(),
  });
};

// POST /register
export async function POST(http: HttpContext): Promise<void> {
  const { name, email, password } = await validate(http, (r) => ({
    name: r.string().trim().min(2).max(80),
    email: r.string().trim().email(),
    password: r.string().min(8).confirmed(),
  }));

  if (await User.query().where("email", email).first()) {
    rejectInput(http, { email: "That email is already registered. Try signing in." }, "/register");
  }

  // `role` is not fillable, so it cannot arrive from the request at all — it is
  // set here, in code, which is the whole point of leaving it off `fillable`.
  const user = new User();
  user.name = name;
  user.email = email;
  user.password = await Hash.make(password);
  user.role = "user";
  await user.save();

  // The link is how the address is proved. In development the mail driver is "log",
  // so the message — link included — is printed in the terminal running the server.
  await user.notify(new VerifyEmailNotification(user.createEmailVerificationToken()));

  await Auth.login(user);
  http.redirect("/verify-email", 303);
}
