import { Component, Link, expose, validate } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { GuestMiddleware } from "zerotal/auth";
import { passwordReset } from "@app/auth/passwords.ts";
import { AuthLayout } from "../layouts/auth.tsx";
import { CARD, ERROR, FIELD, LABEL, PRIMARY } from "../ui.ts";

export const middleware = [GuestMiddleware];

export class ForgotPasswordPage extends Component {
  static layout = AuthLayout;
  static title = "Reset your password";

  @expose @validate((r) => r.required().email()) email = "";

  @expose async send(): Promise<void> {
    await this.validate();
    await passwordReset.sendResetLink(this.email);

    // The same answer whether or not the address exists — anything else turns
    // this form into a way to discover who has an account.
    this.flash(__("If that address has an account, a reset link is on its way."));
  }

  async render(): Promise<HtmlNode> {
    return (
      <div>
        <div class="text-center">
          <h1 class="text-xl font-semibold tracking-tight">{__("Reset your password")}</h1>
          <p class="mt-1.5 text-sm text-muted-foreground">
            {__("We will email you a link to set a new one.")}
          </p>
        </div>

        <div class={`${CARD} mt-6 p-6`}>
          <form onSubmit={this.send} class="space-y-5">
            <div class="space-y-1.5">
              <label class={LABEL} for="email">{__("Email")}</label>
              <input id="email" type="email" autocomplete="email" required class={FIELD} value={this.email} />
              <span error={this.errors.email} class={ERROR} />
            </div>

            <button type="submit" class={`${PRIMARY} w-full`}>{__("Send reset link")}</button>

            <p class="text-xs text-muted-foreground">
              {__("In development the link is written to the server log rather than emailed.")}
            </p>
          </form>
        </div>

        <p class="mt-5 text-center text-sm text-muted-foreground">
          {__("Remembered it?")}{" "}
          <Link href="/login" class="font-medium text-primary hover:underline">{__("Sign in")}</Link>
        </p>
      </div>
    );
  }
}
