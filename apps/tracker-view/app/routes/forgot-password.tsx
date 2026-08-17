import type { HttpContext } from "zerotal";
import { view } from "zerotal";
import { GuestMiddleware } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { passwordReset } from "@app/auth/passwords.ts";
import { AuthLayout } from "../../resources/views/layouts/AuthLayout.tsx";
import { Field, buttonClass } from "../../resources/views/components/Ui.tsx";

export const middleware = [GuestMiddleware];

export const GET = async (http: HttpContext) => {
  const errors = http.session?.get<Record<string, string>>("errors") ?? {};

  view(
    <AuthLayout
      title={__("Reset your password")}
      subtitle={__("We will email you a link to set a new one.")}
      flash={{ success: http.session?.get<string>("success") ?? null }}
      footer={{ text: __("Remembered it?"), link: __("Sign in"), href: route("login") }}
    >
      <form method="post" action={route("forgot-password.store")} class="space-y-5">
        <Field label={__("Email")} name="email" type="email" autocomplete="email" hint={__("In development the link is written to the server log rather than emailed.")} error={errors["email"]} required />
        <button type="submit" class={`${buttonClass("primary")} w-full`}>{__("Send reset link")}</button>
      </form>
    </AuthLayout>,
  );
};

export async function POST(http: HttpContext): Promise<void> {
  const { email } = await validate(http, (r) => ({ email: r.string().trim().email() }));
  await passwordReset.sendResetLink(email);

  // The same answer whether or not the address exists — otherwise this form is a
  // way to discover who has an account.
  http.flash("success", __("If that address has an account, a reset link is on its way."));
  http.redirect(route("forgot-password"), 303);
}
