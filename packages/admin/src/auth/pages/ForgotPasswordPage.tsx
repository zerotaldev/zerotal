/** @jsxImportSource @zerotal/flow */
// "Forgot password" — collects an email and asks the app's broker to send a
// reset link. Mounted only when `auth.passwordReset` is configured.

import { Component, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Panel } from "../../Panel.ts";
import { AuthLayout } from "../AuthLayout.tsx";
import { Icon } from "../../ui/icons.tsx";

const INPUT =
  "mt-1.5 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-ring";

export class ForgotPasswordPage extends Component {
  static layout = AuthLayout;

  @expose email = "";
  @expose sent = false;
  @expose error = "";

  @expose async send(): Promise<void> {
    this.error = "";
    const cfg = Panel.authConfig() ?? {};
    if (!cfg.passwordReset) return;
    const ok = await cfg.passwordReset.sendResetLink(this.email);
    if (ok) this.sent = true;
    else this.error = "We couldn't find an account with that email address.";
  }

  override async render(): Promise<HtmlNode> {
    const base = Panel.config().path.replace(/\/$/, "");
    const loginPath = Panel.authConfig()?.loginPath ?? "/login";

    if (this.sent) {
      return (
        <div class="space-y-4 text-center">
          <div class="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-success/10 text-success">
            <Icon name="mail" class="h-5 w-5" />
          </div>
          <div>
            <h1 class="text-base font-semibold">Check your inbox</h1>
            <p class="mt-1 text-sm text-muted-foreground">
              If an account exists for {this.email}, a reset link is on its way.
            </p>
          </div>
          <a
            href={`${base}${loginPath}`}
            navigate
            class="inline-block text-sm font-medium text-primary hover:underline"
          >
            ← Back to sign in
          </a>
        </div>
      );
    }

    return (
      <form onSubmit={this.send} class="space-y-4">
        <div>
          <h1 class="text-base font-semibold">Reset your password</h1>
          <p class="mt-0.5 text-sm text-muted-foreground">
            We'll email you a link to set a new one.
          </p>
        </div>
        {this.error ? <p class="text-sm text-destructive">{this.error}</p> : null}
        <div>
          <label class="block text-sm font-medium">Email</label>
          <input type="email" value={this.email} placeholder="you@example.com" class={INPUT} />
        </div>
        <button
          type="submit"
          loadingAttr="disabled"
          class="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-60"
        >
          Email reset link
        </button>
        <a
          href={`${base}${loginPath}`}
          navigate
          class="block text-center text-sm font-medium text-primary hover:underline"
        >
          ← Back to sign in
        </a>
      </form>
    );
  }
}
