import { Component, Link, expose, validate } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Auth, GuestMiddleware, Hash } from "zerotal/auth";
import { User } from "@app/models/User.ts";
import { AuthLayout } from "../layouts/auth.tsx";
import { CARD, ERROR, FIELD, LABEL, PRIMARY } from "../ui.ts";

export const middleware = [GuestMiddleware];

/**
 * Register — the same rules as the other builds, checked as you type.
 *
 * `flow:model.live` on the email field is the one thing neither of the others
 * can do without shipping a validator to the browser: each keystroke is checked
 * against the *server's* rule, so "that email is taken" appears before the form
 * is submitted and there is still only one definition of the rule.
 */
export class RegisterPage extends Component {
  static layout = AuthLayout;
  static title = "Create an account";

  @expose @validate((r) => r.required().min(2).max(80)) name = "";
  @expose @validate((r) => r.required().email()) email = "";
  @expose @validate((r) => r.required().min(8)) password = "";

  /**
   * The match is checked on the *confirmation*, not on the password.
   *
   * `confirmed()` on `password` puts the mismatch under the Password field, and
   * Flow validates a field the moment the client writes it — so typing a
   * password raised "confirmation does not match" against a Confirm box the
   * reader had not reached yet. Worse, it stayed: `_validateField` re-checks
   * only the field that changed, and the confirmation carried no rules, so
   * typing a perfectly matching confirmation cleared nothing. The form sat there
   * insisting the passwords differed while they plainly did not.
   *
   * `sameAs` moves the rule to the field the reader can act on, and to the one
   * they touch last — so it is first checked when there is finally something to
   * check.
   */
  @expose @validate((r) => r.required().sameAs("password")) password_confirmation = "";
  @expose error = "";

  /**
   * Editing the password re-opens the question the confirmation answered.
   *
   * Flow validates only the field that changed, so without this the mirror of
   * the original bug appears: confirm correctly, then change the password, and
   * the confirmation's "must match" verdict outlives the thing it described —
   * either a stale error on a field the reader has not touched, or a stale
   * *pass* on one that no longer matches.
   *
   * Cleared rather than re-validated, because re-validating would raise a
   * mismatch against a password still being typed — which is the premature
   * error this whole change is about. The next keystroke in the confirm box, or
   * the submit, decides.
   */
  override async onUpdated(prop: string): Promise<void> {
    if (prop === "password") this.resetValidation("password_confirmation");
  }

  @expose async register(): Promise<void> {
    this.error = "";
    await this.validate();

    // Checked here rather than with a `unique` rule so the message matches the
    // other two builds exactly — same words, same place.
    if (await User.query().where("email", this.email).first()) {
      this.error = __("That email is already registered.");
      return;
    }

    await User.forceCreate({
      name: this.name,
      email: this.email,
      password: await Hash.make(this.password),
      role: "user",
    });

    if (!(await Auth.attempt({ email: this.email, password: this.password }))) {
      this.redirect("/login").withError(
        __("Your account was created, but signing you in failed. Please sign in."),
      );
      return;
    }

    this.redirect("/projects").withSuccess(__("Welcome aboard."));
  }

  async render(): Promise<HtmlNode> {
    return (
      <div>
        <div class="text-center">
          <h1 class="text-xl font-semibold tracking-tight">{__("Create an account")}</h1>
          <p class="mt-1.5 text-sm text-muted-foreground">{__("It takes about ten seconds.")}</p>
        </div>

        <div class={`${CARD} mt-6 p-6`}>
          <form onSubmit={this.register} class="space-y-5">
            {this.error ? <p class={ERROR}>{this.error}</p> : null}

            <div class="space-y-1.5">
              <label class={LABEL} for="name">
                {__("Name")}
              </label>
              <input id="name" autocomplete="name" required class={FIELD} value={this.name} />
              <span error={this.errors.name} class={ERROR} />
            </div>

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
                live
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
                autocomplete="new-password"
                required
                class={FIELD}
                value={this.password}
              />
              <span error={this.errors.password} class={ERROR} />
              <p class="text-xs text-muted-foreground">{__("At least 8 characters.")}</p>
            </div>

            <div class="space-y-1.5">
              <label class={LABEL} for="password_confirmation">
                {__("Confirm password")}
              </label>
              <input
                id="password_confirmation"
                type="password"
                autocomplete="new-password"
                required
                class={FIELD}
                value={this.password_confirmation}
              />
              <span error={this.errors.password_confirmation} class={ERROR} />
            </div>

            <button type="submit" class={`${PRIMARY} w-full`}>
              {__("Create account")}
            </button>
          </form>
        </div>

        <p class="mt-5 text-center text-sm text-muted-foreground">
          {__("Already registered?")}{" "}
          <Link href="/login" class="font-medium text-primary hover:underline">
            {__("Sign in")}
          </Link>
        </p>
      </div>
    );
  }
}
