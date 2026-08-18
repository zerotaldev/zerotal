import { Component, Link, expose, url, validate } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { GuestMiddleware } from "zerotal/auth";
import { passwordReset } from "@app/auth/passwords.ts";
import { AuthLayout } from "../layouts/auth.tsx";
import { CARD, ERROR, FIELD, LABEL, PRIMARY } from "../ui.ts";

export const middleware = [GuestMiddleware];

export class ResetPasswordPage extends Component {
  static layout = AuthLayout;
  static title = "Choose a new password";

  // The token and address arrive in the link that was emailed. `@url` reads
  // them from the query string on the initial render and keeps them there.
  @url token = "";
  @url email = "";

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

  @expose error = "";

  @expose async reset(): Promise<void> {
    this.error = "";
    await this.validate();

    const ok = await passwordReset.reset({
      email: this.email,
      token: this.token,
      password: this.password,
    });

    if (!ok) {
      this.error = __("This reset link is invalid or has expired.");
      return;
    }

    this.redirect("/login").withSuccess(__("Your password has been updated. Sign in with it below."));
  }

  async render(): Promise<HtmlNode> {
    return (
      <div>
        <div class="text-center">
          <h1 class="text-xl font-semibold tracking-tight">{__("Choose a new password")}</h1>
          <p class="mt-1.5 text-sm text-muted-foreground">{__("Then sign in with it.")}</p>
        </div>

        <div class={`${CARD} mt-6 p-6`}>
          <form onSubmit={this.reset} class="space-y-5">
            {this.error ? <p class={ERROR}>{this.error}</p> : null}

            <div class="space-y-1.5">
              <label class={LABEL} for="password">{__("New password")}</label>
              <input id="password" type="password" autocomplete="new-password" required class={FIELD} value={this.password} />
              <span error={this.errors.password} class={ERROR} />
            </div>

            <div class="space-y-1.5">
              <label class={LABEL} for="password_confirmation">{__("Confirm new password")}</label>
              <input id="password_confirmation" type="password" autocomplete="new-password" required class={FIELD} value={this.password_confirmation} />
              <span error={this.errors.password_confirmation} class={ERROR} />
            </div>

            <button type="submit" class={`${PRIMARY} w-full`}>{__("Update password")}</button>
          </form>
        </div>

        <p class="mt-5 text-center text-sm text-muted-foreground">
          {__("Changed your mind?")}{" "}
          <Link href="/login" class="font-medium text-primary hover:underline">{__("Back to sign in")}</Link>
        </p>
      </div>
    );
  }
}
