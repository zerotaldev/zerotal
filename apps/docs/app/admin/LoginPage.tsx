import { Component, ErrorMessage, expose, validate } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Auth } from "zerotal/auth";
import { AdminLayout } from "./AdminLayout.tsx";

const INPUT =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-ink " +
  "outline-none transition focus:border-voltage-700 focus:ring-2 focus:ring-voltage-700/20";

// `this.errors.<field>` always returns an ErrorField sentinel, never undefined — it is
// meant for `<ErrorMessage for={…}>`, which binds to the field and shows itself only
// when that field actually has an error. Rendering the sentinel directly prints
// "[object Object]" on every load; use `errors.has(field)` for a plain conditional.
const ERROR = "mt-1.5 block text-sm text-red-600";

/**
 * Sign-in for the writing desk.
 *
 * `Auth.attempt()` writes `user_id` to the session, and a WebSocket frame cannot
 * carry a `Set-Cookie` — Flow relays the cookie over a one-time HTTP request on
 * redirect, so the ordinary action below is all this needs.
 */
export class LoginPage extends Component {
  static layout = AdminLayout;
  static title = "Sign in";

  @expose @validate((rule) => rule.required().email()) email = "";
  @expose @validate((rule) => rule.required()) password = "";

  @expose async login(): Promise<void> {
    await this.validate();

    if (!(await Auth.attempt({ email: this.email, password: this.password }))) {
      // One message for both wrong-email and wrong-password: which half failed
      // is exactly what a credential-stuffer wants told.
      this.addError("email", "Those credentials do not match our records.");
      this.password = "";
      return;
    }

    this.redirect("/admin");
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div class="mx-auto max-w-sm py-10">
        <h1 class="font-display text-2xl font-bold tracking-[-0.03em]">Sign in</h1>
        <p class="mt-2 text-sm text-stone-600">Publish and edit posts on the blog.</p>

        <form onSubmit={this.login} class="mt-8 space-y-5">
          <div>
            <label class="text-sm font-medium text-stone-700">Email</label>
            <input value={this.email} type="email" autocomplete="username" class={INPUT} />
            <ErrorMessage for={this.errors["email"]} class={ERROR} />
          </div>

          <div>
            <label class="text-sm font-medium text-stone-700">Password</label>
            <input
              value={this.password}
              type="password"
              autocomplete="current-password"
              class={INPUT}
            />
            <ErrorMessage for={this.errors["password"]} class={ERROR} />
          </div>

          <button
            type="submit"
            loadingAttr="disabled"
            class="w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-cream transition hover:bg-ink/90 disabled:opacity-60"
          >
            Sign in
          </button>
        </form>
      </div>
    );
  }
}
