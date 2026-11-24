import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { AuthLayout } from "../../layouts/AuthLayout";
import { buttonClass } from "../../lib/button";
import { Page, titled } from "../../lib/page";
import { FIELD, FIELD_ERROR, FIELD_HINT, FIELD_LABEL_ROW, INPUT, LABEL } from "../../lib/ui";

/**
 * GET /reset-password?token=…&email=… — the link from the email. The token and address
 * ride along with the new password, so the POST (app/routes/(guest)/reset-password.ts)
 * carries everything the server needs to check the link without trusting the session.
 */
export class ResetPasswordPage extends Page {
  static override title = titled("Choose a new password");

  token = "";
  email = "";

  override async onMount(): Promise<void> {
    const url = this.http ? new URL(this.http.request.url) : null;
    this.token = url?.searchParams.get("token") ?? this.token;
    this.email = url?.searchParams.get("email") ?? this.email;
  }

  override layout(page: HtmlNode): HtmlNode {
    return (
      <AuthLayout shell={this.shell()} title="Choose a new password">
        {page}
      </AuthLayout>
    );
  }

  override async render(): Promise<HtmlNode> {
    const { token, email } = this;
    const emailError = this.error("email");
    const passwordError = this.error("password");
    const confirmationError = this.error("password_confirmation");

    return (
      <form method="post" action={route("reset-password.store")} class="space-y-5">
        <input type="hidden" name="token" value={token} />
        <div class={FIELD}>
          <div class={FIELD_LABEL_ROW}>
            <label for="field-email" class={LABEL}>
              Email
            </label>
          </div>
          <input
            class={INPUT}
            type="email"
            value={email}
            readonly
            id="field-email"
            name="email"
            aria-invalid={emailError ? "true" : undefined}
            aria-describedby={emailError ? "field-email-error" : undefined}
          />
          <p id="field-email-error" data-error-for="email" class={FIELD_ERROR} hidden={!emailError}>
            {emailError}
          </p>
        </div>
        <div class={FIELD}>
          <div class={FIELD_LABEL_ROW}>
            <label for="field-password" class={LABEL}>
              New password
            </label>
          </div>
          <input
            class={INPUT}
            type="password"
            autocomplete="new-password"
            autofocus
            required
            id="field-password"
            name="password"
            aria-invalid={passwordError ? "true" : undefined}
            aria-describedby={passwordError ? "field-password-error" : "field-password-hint"}
          />
          <p
            id="field-password-error"
            data-error-for="password"
            class={FIELD_ERROR}
            hidden={!passwordError}
          >
            {passwordError}
          </p>
          <p
            id="field-password-hint"
            data-hint-for="password"
            class={FIELD_HINT}
            hidden={Boolean(passwordError)}
          >
            At least 8 characters.
          </p>
        </div>
        <div class={FIELD}>
          <div class={FIELD_LABEL_ROW}>
            <label for="field-password_confirmation" class={LABEL}>
              Confirm password
            </label>
          </div>
          <input
            class={INPUT}
            type="password"
            autocomplete="new-password"
            required
            id="field-password_confirmation"
            name="password_confirmation"
            aria-invalid={confirmationError ? "true" : undefined}
            aria-describedby={confirmationError ? "field-password_confirmation-error" : undefined}
          />
          <p
            id="field-password_confirmation-error"
            data-error-for="password_confirmation"
            class={FIELD_ERROR}
            hidden={!confirmationError}
          >
            {confirmationError}
          </p>
        </div>
        <button
          type="submit"
          class={buttonClass("primary", "md", "w-full")}
          data-loading-text="Saving…"
        >
          Save new password
        </button>
      </form>
    );
  }
}
