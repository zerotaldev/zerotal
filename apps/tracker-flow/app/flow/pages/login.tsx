import { Component, Link, expose, validate } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Auth, GuestMiddleware } from "zerotal/auth";
import { AuthLayout } from "../layouts/auth.tsx";
import { CARD, ERROR, FIELD, LABEL, PRIMARY } from "../ui.ts";

// Signed-in visitors are sent away from the sign-in form rather than shown it.
export const middleware = [GuestMiddleware];

/**
 * Sign in — feature 1, over a socket.
 *
 * The same three inputs and the same single error message as the other builds.
 * What changes is where the form's state lives: not in `useForm`, not in the
 * browser's own field values, but in these properties on the server. `value=`
 * two-way binds them, so by the time `login()` runs the values are already here
 * and there is nothing to parse out of a request body.
 */
export class LoginPage extends Component {
  static layout = AuthLayout;
  static title = "Sign in";

  @expose @validate((r) => r.required().email()) email = "";
  @expose @validate((r) => r.required()) password = "";
  @expose remember = false;
  @expose error = "";

  @expose async login(): Promise<void> {
    this.error = "";
    await this.validate();

    const ok = await Auth.attempt(
      { email: this.email, password: this.password },
      Boolean(this.remember),
    );

    if (!ok) {
      // One message for a wrong address and a wrong password alike. Saying which
      // was wrong would turn this form into a way to discover valid accounts.
      this.error = __("Those credentials do not match our records.");
      return;
    }

    this.redirect("/projects").withSuccess(__("Welcome back."));
  }

  async render(): Promise<HtmlNode> {
    return (
      <div>
        <div class="text-center">
          <h1 class="text-xl font-semibold tracking-tight">{__("Welcome back")}</h1>
          <p class="mt-1.5 text-sm text-muted-foreground">
            {__("Sign in to your Tracker account.")}
          </p>
        </div>

        <div class={`${CARD} mt-6 p-6`}>
          <form onSubmit={this.login} class="space-y-5">
            {this.error ? <p class={ERROR}>{this.error}</p> : null}

            <div class="space-y-1.5">
              <label class={LABEL} for="email">
                {__("Email")}
              </label>
              <input
                id="email"
                type="email"
                autocomplete="email"
                required
                class={FIELD}
                value={this.email}
              />
              <span error={this.errors.email} class={ERROR} />
            </div>

            <div class="space-y-1.5">
              <label class={LABEL} for="password">
                {__("Password")}
              </label>
              <input
                id="password"
                type="password"
                autocomplete="current-password"
                required
                class={FIELD}
                value={this.password}
              />
              <span error={this.errors.password} class={ERROR} />
            </div>

            <label class="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={this.remember} class="rounded border-input" />
              {__("Remember me")}
            </label>

            <button type="submit" class={`${PRIMARY} w-full`}>
              {__("Sign in")}
            </button>

            <p class="text-center text-sm">
              <Link href="/forgot-password" class="text-muted-foreground hover:text-foreground">
                {__("Forgot your password?")}
              </Link>
            </p>
          </form>
        </div>

        <p class="mt-5 text-center text-sm text-muted-foreground">
          {__("Don’t have an account?")}{" "}
          <Link href="/register" class="font-medium text-primary hover:underline">
            {__("Create one")}
          </Link>
        </p>
      </div>
    );
  }
}
