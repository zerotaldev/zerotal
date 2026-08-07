import { Component, expose, Link } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { GuestMiddleware } from "zerotal/auth";
import { passwordReset } from "@app/auth/passwords";
import { AppLayout } from "../layouts/app";
import { FIELD, LABEL, PRIMARY, CARD, NOTICE } from "../ui";

export const middleware = [GuestMiddleware];

export class ForgotPasswordPage extends Component {
  static layout = AppLayout;
  static title = "Reset your password";

  @expose email = "";
  @expose sent = false;

  @expose async send(): Promise<void> {
    await passwordReset.sendResetLink(this.email);

    // Always the same outcome, whether or not the address has an account.
    // Reporting "no such user" here would make this form a way to enumerate
    // which addresses are registered.
    this.sent = true;
  }

  async render(): Promise<HtmlNode> {
    return (
      <section class={CARD}>
        <h1 class="text-2xl font-bold tracking-tight">Reset your password</h1>
        <p class="mt-1 text-sm text-gray-600">
          Give us the address you signed up with and we will send a link.
        </p>

        {this.sent ? (
          <p class={`${NOTICE} mt-6`}>
            If that address has an account, a reset link is on its way. In development the link is
            written to the server log rather than emailed.
          </p>
        ) : (
          <form onSubmit={this.send} class="mt-6 space-y-4">
            <div>
              <label class={LABEL} for="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autocomplete="email"
                required
                class={FIELD}
                value={this.email}
              />
            </div>

            <button type="submit" class={PRIMARY}>
              Send reset link
            </button>
          </form>
        )}

        <p class="mt-6 text-sm text-gray-600">
          <Link href="/login" class="text-indigo-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </section>
    );
  }
}
