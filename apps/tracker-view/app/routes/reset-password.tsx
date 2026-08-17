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
  const url = new URL(http.request.url);

  view(
    <AuthLayout
      title={__("Choose a new password")}
      subtitle={__("Then sign in with it.")}
      flash={{ error: http.session?.get<string>("error") ?? null }}
      footer={{ text: __("Changed your mind?"), link: __("Back to sign in"), href: route("login") }}
    >
      <form method="post" action={route("reset-password.store")} class="space-y-5">
        {/* Token and email ride along as hidden fields so the POST carries
            everything the server needs without trusting the session. */}
        <input type="hidden" name="token" value={url.searchParams.get("token") ?? ""} />
        <input type="hidden" name="email" value={url.searchParams.get("email") ?? ""} />
        <Field label={__("New password")} name="password" type="password" autocomplete="new-password" hint={__("At least 8 characters.")} error={errors["password"]} required />
        <Field label={__("Confirm password")} name="password_confirmation" type="password" autocomplete="new-password" error={errors["password_confirmation"]} required />
        <button type="submit" class={`${buttonClass("primary")} w-full`}>{__("Update password")}</button>
      </form>
    </AuthLayout>,
  );
};

export async function POST(http: HttpContext): Promise<void> {
  const { token, email, password } = await validate(http, (r) => ({
    token: r.string().min(1),
    email: r.string().trim().email(),
    password: r.string().min(8).confirmed(),
  }));

  const ok = await passwordReset.reset({ email, token, password });
  if (!ok) {
    http.flash("error", __("Those credentials do not match our records."));
    http.redirect(route("forgot-password"), 303);
    return;
  }

  http.flash("success", __("Password updated. Sign in with it."));
  http.redirect(route("login"), 303);
}
