import { Component, expose, url, Link } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { GuestMiddleware } from "zerotal/auth";
import { passwordReset } from "@app/auth/passwords";
import { AppLayout } from "../layouts/app";
import { FIELD, LABEL, PRIMARY, CARD, ERROR, NOTICE } from "../ui";

export const middleware = [GuestMiddleware];

export class ResetPasswordPage extends Component {
  static layout = AppLayout;
  static title = "Choose a new password";

  /** Seeded from the reset link's query string (`?token=…&email=…`). */
  @url token = "";
  @url email = "";

  @expose password = "";
  @expose passwordConfirmation = "";
  @expose error = "";
  @expose done = false;

  @expose async reset(): Promise<void> {
    this.error = "";

    if (this.password.length < 8) {
      this.error = "Choose a password of at least 8 characters.";
      return;
    }
    if (this.password !== this.passwordConfirmation) {
      this.error = "The two passwords do not match.";
      return;
    }

    const ok = await passwordReset.reset({
      email: this.email,
      token: this.token,
      password: this.password,
    });

    if (ok) this.done = true;
    else this.error = "This reset link is invalid or has expired.";
  }

  async render(): Promise<HtmlNode> {
    if (this.done) {
      return (
        <section class={CARD}>
          <h1 class="text-2xl font-bold tracking-tight">Password updated</h1>
          <p class={`${NOTICE} mt-4`}>You can now sign in with your new password.</p>
          <p class="mt-6 text-sm text-gray-600">
            <Link href="/login" class="text-indigo-600 hover:underline">
              Go to sign in
            </Link>
          </p>
        </section>
      );
    }

    return (
      <section class={CARD}>
        <h1 class="text-2xl font-bold tracking-tight">Choose a new password</h1>
        <p class="mt-1 text-sm text-gray-600">Resetting the password for {this.email}.</p>

        <form onSubmit={this.reset} class="mt-6 space-y-4">
          {this.error ? <p class={ERROR}>{this.error}</p> : null}

          <div>
            <label class={LABEL} for="password">
              New password
            </label>
            <input
              id="password"
              type="password"
              autocomplete="new-password"
              required
              class={FIELD}
              value={this.password}
            />
          </div>

          <div>
            <label class={LABEL} for="password_confirmation">
              Confirm password
            </label>
            <input
              id="password_confirmation"
              type="password"
              autocomplete="new-password"
              required
              class={FIELD}
              value={this.passwordConfirmation}
            />
          </div>

          <button type="submit" class={PRIMARY}>
            Update password
          </button>
        </form>
      </section>
    );
  }
}
