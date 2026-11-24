import { Component, expose, Link } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Auth, GuestMiddleware } from "zerotal/auth";
import { AppLayout } from "../layouts/app";
import { FIELD, LABEL, PRIMARY, CARD, ERROR } from "../ui";

// Signed-in visitors are sent away from the sign-in form rather than shown it.
export const middleware = [GuestMiddleware];

export class LoginPage extends Component {
  static layout = AppLayout;
  static title = "Sign in";

  @expose email = "";
  @expose password = "";
  @expose remember = false;
  @expose error = "";

  @expose async login(): Promise<void> {
    this.error = "";

    const ok = await Auth.attempt(
      { email: this.email, password: this.password },
      Boolean(this.remember),
    );

    if (!ok) {
      // One message for a wrong address and a wrong password alike — saying
      // which was wrong turns this form into a way to discover valid accounts.
      this.error = "Those credentials do not match our records.";
      return;
    }

    this.redirect("/profile").withSuccess("Welcome back.");
  }

  async render(): Promise<HtmlNode> {
    return (
      <section class={CARD}>
        <h1 class="text-2xl font-bold tracking-tight">Sign in</h1>
        <p class="mt-1 text-sm text-gray-600">Enter your details to continue.</p>

        <form onSubmit={this.login} class="mt-6 space-y-4">
          {this.error ? <p class={ERROR}>{this.error}</p> : null}

          <div>
            <label class={LABEL} for="email">
              Email
            </label>
            <input id="email" type="email" autocomplete="email" required class={FIELD} value={this.email} />
          </div>

          <div>
            <label class={LABEL} for="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autocomplete="current-password"
              required
              class={FIELD}
              value={this.password}
            />
          </div>

          <label class="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={this.remember} class="rounded border-gray-300" />
            Remember me
          </label>

          <button type="submit" class={PRIMARY}>
            Sign in
          </button>
        </form>

        <div class="mt-6 flex items-center justify-between text-sm">
          <Link href="/forgot-password" class="text-indigo-600 hover:underline">
            Forgot your password?
          </Link>
          <Link href="/register" class="text-indigo-600 hover:underline">
            Create an account
          </Link>
        </div>
      </section>
    );
  }
}
