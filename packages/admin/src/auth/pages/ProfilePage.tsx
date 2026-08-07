/** @jsxImportSource @zerotal/flow */
// In-panel profile page — update details, change password, and sign out. Uses
// `@zerotal/auth`'s `Auth` + `Hash`. Mounted behind the panel guard.

import { Component, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import type { HttpContext } from "@zerotal/core";
import { Auth, Hash } from "@zerotal/auth";
import { Panel } from "../../Panel.ts";
import { AdminLayout } from "../../ui/AdminLayout.tsx";
import { Icon } from "../../ui/icons.tsx";

const INPUT =
  "mt-1.5 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-ring";
const PRIMARY_BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-60";

export class ProfilePage extends Component {
  static layout = AdminLayout;

  @expose name = "";
  @expose email = "";
  @expose currentPassword = "";
  @expose newPassword = "";
  @expose newPasswordConfirm = "";
  @expose profileError = "";
  @expose passwordError = "";

  private _user(): Record<string, unknown> | undefined {
    return Auth.userOrNull() as unknown as Record<string, unknown> | undefined;
  }

  override async onMount(_ctx?: HttpContext): Promise<void> {
    const u = this._user();
    if (u) {
      this.name = String(u["name"] ?? "");
      this.email = String(u["email"] ?? "");
    }
  }

  @expose async saveProfile(): Promise<void> {
    this.profileError = "";
    const u = this._user();
    if (!u) return;
    const cfg = Panel.authConfig() ?? {};
    const data = { name: this.name, email: this.email };
    try {
      if (cfg.updateProfile) {
        await cfg.updateProfile(u, data);
      } else {
        const m = u as {
          fill?: (d: Record<string, unknown>) => void;
          save?: () => Promise<unknown>;
        };
        if (typeof m.fill === "function") m.fill(data);
        else for (const [k, v] of Object.entries(data)) u[k] = v;
        await m.save?.();
      }
      this.flash("Profile updated.");
    } catch {
      this.profileError = "Could not update your profile.";
    }
  }

  @expose async changePassword(): Promise<void> {
    this.passwordError = "";
    const u = this._user();
    if (!u) return;
    if (this.newPassword.length < 8) {
      this.passwordError = "New password must be at least 8 characters.";
      return;
    }
    if (this.newPassword !== this.newPasswordConfirm) {
      this.passwordError = "The new passwords do not match.";
      return;
    }
    const getHash = u["getAuthPassword"];
    const hashed =
      typeof getHash === "function" ? (getHash as () => string).call(u) : u["password"];
    const ok = hashed ? await Hash.check(this.currentPassword, String(hashed)) : false;
    if (!ok) {
      this.passwordError = "Your current password is incorrect.";
      return;
    }
    u["password"] = await Hash.make(this.newPassword);
    await (u as { save?: () => Promise<unknown> }).save?.();
    this.currentPassword = "";
    this.newPassword = "";
    this.newPasswordConfirm = "";
    this.flash("Password changed.");
  }

  @expose async signOut(): Promise<void> {
    await Auth.logout();
    const cfg = Panel.authConfig() ?? {};
    const base = Panel.config().path.replace(/\/$/, "");
    this.redirect(`${base}${cfg.loginPath ?? "/login"}`).withSuccess("Signed out.");
  }

  override async render(): Promise<HtmlNode> {
    const base = Panel.config().path.replace(/\/$/, "");
    const cfg = Panel.authConfig() ?? {};
    const u = this._user();
    const verify = cfg.emailVerification;
    const unverified = !!verify && !!u && !verify.isVerified(u);
    const card =
      "rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6";

    return (
      <div class="mx-auto w-full max-w-2xl space-y-6">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <nav class="mb-1 text-xs text-muted-foreground">
              <a href={base} navigate class="hover:text-foreground">
                Dashboard
              </a>
              <span class="px-1.5">/</span>
              <span>Profile</span>
            </nav>
            <h1 class="text-2xl font-semibold tracking-tight">Your profile</h1>
          </div>
          <button
            type="button"
            onClick={this.signOut}
            class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm font-medium transition hover:bg-accent hover:text-accent-foreground"
          >
            <Icon name="logout" class="h-4 w-4" /> Sign out
          </button>
        </div>

        {unverified ? (
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
            <span class="flex items-center gap-2">
              <Icon name="mail" class="h-4 w-4 text-amber-500" /> Your email address is not
              verified.
            </span>
            <a
              href={`${base}/verify-email`}
              navigate
              class="font-medium text-primary hover:underline"
            >
              Verify now →
            </a>
          </div>
        ) : null}

        {/* Profile details */}
        <form onSubmit={this.saveProfile} class={card}>
          <h2 class="text-sm font-semibold">Account details</h2>
          {this.profileError ? (
            <p class="mt-2 text-sm text-destructive">{this.profileError}</p>
          ) : null}
          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label class="block text-sm font-medium">Name</label>
              <input value={this.name} class={INPUT} />
            </div>
            <div>
              <label class="block text-sm font-medium">Email</label>
              <input type="email" value={this.email} class={INPUT} />
            </div>
          </div>
          <div class="mt-4 flex justify-end">
            <button type="submit" loadingAttr="disabled" class={PRIMARY_BTN}>
              Save changes
            </button>
          </div>
        </form>

        {/* Change password */}
        <form onSubmit={this.changePassword} class={card}>
          <h2 class="text-sm font-semibold">Change password</h2>
          {this.passwordError ? (
            <p class="mt-2 text-sm text-destructive">{this.passwordError}</p>
          ) : null}
          <div class="mt-4 space-y-4">
            <div>
              <label class="block text-sm font-medium">Current password</label>
              <input
                type="password"
                value={this.currentPassword}
                autocomplete="current-password"
                class={INPUT}
              />
            </div>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label class="block text-sm font-medium">New password</label>
                <input
                  type="password"
                  value={this.newPassword}
                  autocomplete="new-password"
                  class={INPUT}
                />
              </div>
              <div>
                <label class="block text-sm font-medium">Confirm new password</label>
                <input
                  type="password"
                  value={this.newPasswordConfirm}
                  autocomplete="new-password"
                  class={INPUT}
                />
              </div>
            </div>
          </div>
          <div class="mt-4 flex justify-end">
            <button type="submit" loadingAttr="disabled" class={PRIMARY_BTN}>
              Update password
            </button>
          </div>
        </form>
      </div>
    );
  }
}
