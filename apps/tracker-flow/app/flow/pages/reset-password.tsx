import { Component, Link, expose, url, validate } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { GuestMiddleware } from "zerotal/auth";
import { passwordReset } from "@app/auth/passwords.ts";
import { AuthLayout } from "../layouts/auth.tsx";
import { CARD, ERROR, FIELD, LABEL, PRIMARY } from "../ui.ts";

export const middleware = [GuestMiddleware];

export class ResetPasswordPage extends Component {
  static layout = AuthLayout;
  static title = "Choose a new password";

  // The token and address arrive in the link that was emailed. `@url` reads
  // them from the query string on the initial render and keeps them there.
  @url token = "";
  @url email = "";

  @expose @validate((r) => r.required().min(8).confirmed()) password = "";
  @expose password_confirmation = "";
  @expose error = "";

  @expose async reset(): Promise<void> {
    this.error = "";
    await this.validate();

    const ok = await passwordReset.reset({
      email: this.email,
      token: this.token,
      password: this.password,
    });

    if (!ok) {
      this.error = __("This reset link is invalid or has expired.");
      return;
    }

    this.redirect("/login").withSuccess(__("Your password has been updated. Sign in with it below."));
  }

  async render(): Promise<HtmlNode> {
    return (
      <div>
        <div class="text-center">
          <h1 class="text-xl font-semibold tracking-tight">{__("Choose a new password")}</h1>
          <p class="mt-1.5 text-sm text-muted-foreground">{__("Then sign in with it.")}</p>
        </div>

        <div class={`${CARD} mt-6 p-6`}>
          <form onSubmit={this.reset} class="space-y-5">
            {this.error ? <p class={ERROR}>{this.error}</p> : null}

            <div class="space-y-1.5">
              <label class={LABEL} for="password">{__("New password")}</label>
              <input id="password" type="password" autocomplete="new-password" required class={FIELD} value={this.password} />
              <span error={this.errors.password} class={ERROR} />
            </div>

            <div class="space-y-1.5">
              <label class={LABEL} for="password_confirmation">{__("Confirm new password")}</label>
              <input id="password_confirmation" type="password" autocomplete="new-password" required class={FIELD} value={this.password_confirmation} />
            </div>

            <button type="submit" class={`${PRIMARY} w-full`}>{__("Update password")}</button>
          </form>
        </div>

        <p class="mt-5 text-center text-sm text-muted-foreground">
          {__("Changed your mind?")}{" "}
          <Link href="/login" class="font-medium text-primary hover:underline">{__("Back to sign in")}</Link>
        </p>
      </div>
    );
  }
}
