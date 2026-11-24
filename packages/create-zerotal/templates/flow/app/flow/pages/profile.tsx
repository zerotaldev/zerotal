import { Component, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Auth, AuthMiddleware, Hash } from "zerotal/auth";
import { User } from "@app/models/User";
import { AppLayout } from "../layouts/app";
import { FIELD, LABEL, PRIMARY, SECONDARY, CARD, ERROR, NOTICE } from "../ui";

// Only for signed-in visitors; everyone else is sent to the sign-in form.
export const middleware = [AuthMiddleware];

export class ProfilePage extends Component {
  static layout = AppLayout;
  static title = "Your profile";

  @expose name = "";
  @expose email = "";
  @expose detailsError = "";
  @expose detailsSaved = false;

  @expose currentPassword = "";
  @expose password = "";
  @expose passwordConfirmation = "";
  @expose passwordError = "";
  @expose passwordSaved = false;

  /** Seed the form from the signed-in user on first render. */
  async onMount(): Promise<void> {
    const user = Auth.user() as User;
    this.name = user.name;
    this.email = user.email;
  }

  @expose async saveDetails(): Promise<void> {
    this.detailsError = "";
    this.detailsSaved = false;

    const user = Auth.user() as User;

    if (this.name.trim() === "" || this.email.trim() === "") {
      this.detailsError = "Name and email are required.";
      return;
    }

    // Someone else holding this address is the one case that must be rejected;
    // keeping your own is not a conflict.
    const taken = await User.query().where("email", this.email).first();
    if (taken && taken.id !== user.id) {
      this.detailsError = "That email is already in use.";
      return;
    }

    user.name = this.name;
    user.email = this.email;
    await user.save();

    this.detailsSaved = true;
  }

  @expose async changePassword(): Promise<void> {
    this.passwordError = "";
    this.passwordSaved = false;

    const user = Auth.user() as User;

    // Proving the current password is what stops a borrowed session from
    // locking the real owner out of their account.
    if (!(await Hash.check(this.currentPassword, user.password))) {
      this.passwordError = "Your current password is not correct.";
      return;
    }
    if (this.password.length < 8) {
      this.passwordError = "Choose a password of at least 8 characters.";
      return;
    }
    if (this.password !== this.passwordConfirmation) {
      this.passwordError = "The two passwords do not match.";
      return;
    }

    user.password = await Hash.make(this.password);
    await user.save();

    this.currentPassword = "";
    this.password = "";
    this.passwordConfirmation = "";
    this.passwordSaved = true;
  }

  @expose async signOut(): Promise<void> {
    await Auth.logout();
    this.redirect("/login").withSuccess("Signed out.");
  }

  async render(): Promise<HtmlNode> {
    return (
      <div class="mx-auto w-full max-w-lg space-y-6">
        <div>
          <h1 class="text-3xl font-bold tracking-tight">Your profile</h1>
          <p class="mt-1 text-gray-600">Update your details or change your password.</p>
        </div>

        <section class={CARD}>
          <h2 class="text-lg font-semibold">Details</h2>

          <form onSubmit={this.saveDetails} class="mt-4 space-y-4">
            {this.detailsError ? <p class={ERROR}>{this.detailsError}</p> : null}
            {this.detailsSaved ? <p class={NOTICE}>Details saved.</p> : null}

            <div>
              <label class={LABEL} for="name">
                Name
              </label>
              <input id="name" type="text" required class={FIELD} value={this.name} />
            </div>

            <div>
              <label class={LABEL} for="email">
                Email
              </label>
              <input id="email" type="email" required class={FIELD} value={this.email} />
            </div>

            <button type="submit" class={PRIMARY}>
              Save details
            </button>
          </form>
        </section>

        <section class={CARD}>
          <h2 class="text-lg font-semibold">Password</h2>

          <form onSubmit={this.changePassword} class="mt-4 space-y-4">
            {this.passwordError ? <p class={ERROR}>{this.passwordError}</p> : null}
            {this.passwordSaved ? <p class={NOTICE}>Password updated.</p> : null}

            <div>
              <label class={LABEL} for="current_password">
                Current password
              </label>
              <input
                id="current_password"
                type="password"
                autocomplete="current-password"
                required
                class={FIELD}
                value={this.currentPassword}
              />
            </div>

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
                Confirm new password
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
              Change password
            </button>
          </form>
        </section>

        <section class={CARD}>
          <h2 class="text-lg font-semibold">Session</h2>
          <p class="mt-1 text-sm text-gray-600">Sign out of this browser.</p>
          <button type="button" onClick={this.signOut} class={`${SECONDARY} mt-4`}>
            Sign out
          </button>
        </section>
      </div>
    );
  }
}
