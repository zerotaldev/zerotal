/** @jsxImportSource @zerotal/flow */
// Login screen — authenticates via `@zerotal/auth`'s `Auth.attempt`, then
// redirects into the panel. Mounted only when `Panel.auth({ enabled: true })`.

import { Component, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Auth } from "@zerotal/auth";
import { Panel } from "../../Panel.ts";
import { AuthLayout } from "../AuthLayout.tsx";
import { Icon } from "../../ui/icons.tsx";

const INPUT =
  "mt-1.5 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-ring";

export class LoginPage extends Component {
  static layout = AuthLayout;

  @expose email = "";
  @expose password = "";
  @expose remember = false;
  @expose error = "";

  @expose async login(): Promise<void> {
    this.error = "";
    const cfg = Panel.authConfig() ?? {};
    const id = cfg.identifier ?? "email";
    const creds: Record<string, unknown> = { [id]: this.email, password: this.password };
    let ok: boolean;
    if (cfg.authenticateWhen) {
      ok = await Auth.attemptWhen(
        creds,
        cfg.authenticateWhen as (u: unknown) => boolean | Promise<boolean>,
        !!this.remember,
      );
    } else {
      ok = await Auth.attempt(creds, !!this.remember);
    }
    if (ok) {
      const base = Panel.config().path.replace(/\/$/, "");
      this.redirect(cfg.redirectTo ?? (base || "/")).withSuccess("Welcome back.");
    } else {
      this.error = "These credentials do not match our records.";
    }
  }

  override async render(): Promise<HtmlNode> {
    const cfg = Panel.authConfig() ?? {};
    const base = Panel.config().path.replace(/\/$/, "");
    const id = cfg.identifier ?? "email";
    const idLabel = id === "email" ? "Email" : id.charAt(0).toUpperCase() + id.slice(1);
    const showRemember = cfg.remember ?? true;
    const showForgot = !!cfg.passwordReset;

    return (
      <form onSubmit={this.login} class="space-y-4">
        <div>
          <h1 class="text-base font-semibold">Sign in</h1>
          <p class="mt-0.5 text-sm text-muted-foreground">Enter your credentials to continue.</p>
        </div>

        {this.error ? (
          <div class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <Icon name="x-circle" class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{this.error}</span>
          </div>
        ) : null}

        <div>
          <label class="block text-sm font-medium">{idLabel}</label>
          <input
            type={id === "email" ? "email" : "text"}
            value={this.email}
            autocomplete="username"
            placeholder={id === "email" ? "you@example.com" : idLabel}
            class={INPUT}
          />
        </div>

        <div>
          <div class="flex items-center justify-between">
            <label class="block text-sm font-medium">Password</label>
            {showForgot ? (
              <a
                href={`${base}/forgot-password`}
                navigate
                class="text-xs font-medium text-primary hover:underline"
              >
                Forgot?
              </a>
            ) : null}
          </div>
          <input
            type="password"
            value={this.password}
            autocomplete="current-password"
            class={INPUT}
          />
        </div>

        {showRemember ? (
          <label class="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={this.remember}
              class="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
            />
            Remember me
          </label>
        ) : null}

        <button
          type="submit"
          loadingAttr="disabled"
          class="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-60"
        >
          Sign in
        </button>
      </form>
    );
  }
}
