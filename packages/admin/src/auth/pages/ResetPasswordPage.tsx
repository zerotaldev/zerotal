/** @jsxImportSource @zerotal/flow */
// "Reset password" — consumes the token+email from the reset link query and asks
// the app's broker to set the new password.

import { Component, expose, url } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Panel } from "../../Panel.ts";
import { AuthLayout } from "../AuthLayout.tsx";
import { Icon } from "../../ui/icons.tsx";

const INPUT =
  "mt-1.5 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-ring";

export class ResetPasswordPage extends Component {
  static layout = AuthLayout;

  /** Seeded from the reset link query (`?token=…&email=…`). */
  @url token = "";
  @url email = "";
  @expose password = "";
  @expose confirm = "";
  @expose error = "";
  @expose done = false;

  @expose async reset(): Promise<void> {
    this.error = "";
    const cfg = Panel.authConfig() ?? {};
    if (!cfg.passwordReset) return;
    if (this.password.length < 8) {
      this.error = "Password must be at least 8 characters.";
      return;
    }
    if (this.password !== this.confirm) {
      this.error = "The passwords do not match.";
      return;
    }
    const ok = await cfg.passwordReset.reset({
      email: this.email,
      token: this.token,
      password: this.password,
    });
    if (ok) this.done = true;
    else this.error = "This reset link is invalid or has expired.";
  }

  override async render(): Promise<HtmlNode> {
    const base = Panel.config().path.replace(/\/$/, "");
    const loginPath = Panel.authConfig()?.loginPath ?? "/login";

    if (this.done) {
      return (
        <div class="space-y-4 text-center">
          <div class="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-success/10 text-success">
            <Icon name="check-circle" class="h-5 w-5" />
          </div>
          <div>
            <h1 class="text-base font-semibold">Password updated</h1>
            <p class="mt-1 text-sm text-muted-foreground">
              You can now sign in with your new password.
            </p>
          </div>
          <a
            href={`${base}${loginPath}`}
            navigate
            class="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
          >
            Go to sign in
          </a>
        </div>
      );
    }

    return (
      <form onSubmit={this.reset} class="space-y-4">
        <div>
          <h1 class="text-base font-semibold">Choose a new password</h1>
          {this.email ? <p class="mt-0.5 text-sm text-muted-foreground">for {this.email}</p> : null}
        </div>
        {this.error ? (
          <div class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <Icon name="x-circle" class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{this.error}</span>
          </div>
        ) : null}
        <div>
          <label class="block text-sm font-medium">New password</label>
          <input type="password" value={this.password} autocomplete="new-password" class={INPUT} />
        </div>
        <div>
          <label class="block text-sm font-medium">Confirm password</label>
          <input type="password" value={this.confirm} autocomplete="new-password" class={INPUT} />
        </div>
        <button
          type="submit"
          loadingAttr="disabled"
          class="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-60"
        >
          Reset password
        </button>
      </form>
    );
  }
}
