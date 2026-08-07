import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Auth, GuestMiddleware, Hash } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { User } from "@app/models/User";

export const middleware = [GuestMiddleware];

export const GET = async () => {
  return Inertia.render("register", { title: "Create an account" });
};

export async function POST(http: HttpContext): Promise<void> {
  const { name, email, password } = await validate(http, (r) => ({
    name: r.string().trim().min(2).max(80),
    email: r.string().trim().email(),
    password: r.string().min(8).confirmed(),
  }));

  const taken = await User.query().where("email", email).first();
  if (taken) {
    http.flash("error", "That email is already registered.");
    http.redirect("/register", 303);
    return;
  }

  // `role` is not fillable, so it cannot arrive from the request at all — it is
  // set here, in code, which is the whole point of leaving it off `fillable`.
  const user = new User();
  user.name = name;
  user.email = email;
  user.password = await Hash.make(password);
  user.role = "user";
  await user.save();

  await Auth.attempt({ email, password });
  http.flash("success", "Welcome aboard.");
  http.redirect("/profile", 303);
}
