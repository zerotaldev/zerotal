import type { HttpContext } from "zerotal";
import { view } from "zerotal";
import { Auth, GuestMiddleware, Hash } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { User } from "@app/models/User.ts";
import { AuthLayout } from "../../resources/views/layouts/AuthLayout.tsx";
import { Field, buttonClass } from "../../resources/views/components/Ui.tsx";

export const middleware = [GuestMiddleware];

export const GET = async (http: HttpContext) => {
  const errors = http.session?.get<Record<string, string>>("errors") ?? {};
  const old = http.session?.get<Record<string, string>>("old") ?? {};

  view(
    <AuthLayout
      title={__("Create an account")}
      subtitle={__("It takes about ten seconds.")}
      flash={{ error: http.session?.get<string>("error") ?? null }}
      footer={{ text: __("Already registered?"), link: __("Sign in"), href: route("login") }}
    >
      <form method="post" action={route("register.store")} class="space-y-5">
        <Field label={__("Name")} name="name" autocomplete="name" value={old["name"]} error={errors["name"]} required />
        <Field label={__("Email")} name="email" type="email" autocomplete="email" value={old["email"]} error={errors["email"]} required />
        <Field label={__("Password")} name="password" type="password" autocomplete="new-password" hint={__("At least 8 characters.")} error={errors["password"]} required />
        <Field label={__("Confirm password")} name="password_confirmation" type="password" autocomplete="new-password" error={errors["password_confirmation"]} required />
        <button type="submit" class={`${buttonClass("primary")} w-full`}>{__("Create an account")}</button>
      </form>
    </AuthLayout>,
  );
};

export async function POST(http: HttpContext): Promise<void> {
  const { name, email, password } = await validate(http, (r) => ({
    name: r.string().trim().min(2).max(80),
    email: r.string().trim().email(),
    // The match is checked on the confirmation, not on the password.
    // `confirmed()` here files the mismatch under `password`, so it rendered
    // beneath the Password box while the Confirm box — which already has an
    // error slot wired up in the form — could never show anything at all.
    password: r.string().min(8),
    password_confirmation: r.string().sameAs("password"),
  }));

  if (await User.query().where("email", email).first()) {
    http.flash("error", __("That email is already registered."));
    http.redirect(route("register"), 303);
    return;
  }

  // `role` is not fillable, so it cannot arrive from the request at all.
  const user = new User();
  user.name = name;
  user.email = email;
  user.password = await Hash.make(password);
  user.role = "user";
  await user.save();

  if (!(await Auth.attempt({ email, password }))) {
    http.flash("error", __("Your account was created, but signing you in failed. Please sign in."));
    http.redirect(route("login"), 303);
    return;
  }

  http.flash("success", __("Welcome aboard."));
  http.redirect(route("projects"), 303);
}
