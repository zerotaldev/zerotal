/** @jsxImportSource @zerotal/flow */
// Email-verification notice — for a signed-in but unverified user. Re-sends the
// verification link via the app's hook. Mounted when `auth.emailVerification` is set.

import { Component, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Auth } from "@zerotal/auth";
import { Panel } from "../../Panel.ts";
import { AuthLayout } from "../AuthLayout.tsx";
import { Icon } from "../../ui/icons.tsx";

export class VerifyEmailPage extends Component {
  static layout = AuthLayout;

  @expose resent = false;

  @expose async resend(): Promise<void> {
    const cfg = Panel.authConfig() ?? {};
    const u = Auth.userOrNull() as unknown;
    if (cfg.emailVerification && u) {
      await cfg.emailVerification.resend(u);
      this.resent = true;
    }
  }

  @expose async signOut(): Promise<void> {
    await Auth.logout();
    const cfg = Panel.authConfig() ?? {};
    const base = Panel.config().path.replace(/\/$/, "");
    this.redirect(`${base}${cfg.loginPath ?? "/login"}`);
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div class="space-y-4 text-center">
        <div class="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon name="mail" class="h-5 w-5" />
        </div>
        <div>
          <h1 class="text-base font-semibold">Verify your email</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            We've sent a verification link to your inbox. Click it to activate your account.
          </p>
        </div>
        {this.resent ? (
          <p class="flex items-center justify-center gap-1.5 text-sm text-success">
            <Icon name="check-circle" class="h-4 w-4" /> A fresh link is on its way.
          </p>
        ) : null}
        <button
          type="button"
          onClick={this.resend}
          loadingAttr="disabled"
          class="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-60"
        >
          Resend verification email
        </button>
        <button
          type="button"
          onClick={this.signOut}
          class="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </div>
    );
  }
}
