import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { mailIsLogged } from "@app/support/mail";
import { AuthLayout } from "../../layouts/AuthLayout";
import { buttonClass } from "../../lib/button";
import { Page, titled } from "../../lib/page";
import { FIELD, FIELD_ERROR, FIELD_HINT, FIELD_LABEL_ROW, INPUT, LABEL } from "../../lib/ui";

/** GET /forgot-password. The form posts to app/routes/(guest)/forgot-password.ts. */
export class ForgotPasswordPage extends Page {
  static override title = titled("Forgot your password?");

  override layout(page: HtmlNode): HtmlNode {
    return (
      <AuthLayout
        shell={this.shell()}
        title="Forgot your password?"
        description="Enter the address you signed up with and we will send you a link to choose a new one."
        footer={
          <a href={route("login")} class="font-medium text-primary hover:underline">
            Back to sign in
          </a>
        }
      >
        {page}
      </AuthLayout>
    );
  }

  override async render(): Promise<HtmlNode> {
    const email = this.old("email");
    const error = this.error("email");
    // Mail is printed by the server rather than sent (MAIL_DRIVER=log).
    const hint = mailIsLogged()
      ? "Mail is printed in the terminal running the server, not sent (MAIL_DRIVER=log)."
      : undefined;

    return (
      <form method="post" action={route("forgot-password.store")} class="space-y-5">
        <div class={FIELD}>
          <div class={FIELD_LABEL_ROW}>
            <label for="field-email" class={LABEL}>
              Email
            </label>
          </div>
          <input
            class={INPUT}
            type="email"
            autocomplete="email"
            autofocus
            value={email}
            required
            id="field-email"
            name="email"
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "field-email-error" : hint ? "field-email-hint" : undefined}
          />
          <p id="field-email-error" data-error-for="email" class={FIELD_ERROR} hidden={!error}>
            {error}
          </p>
          {hint ? (
            <p
              id="field-email-hint"
              data-hint-for="email"
              class={FIELD_HINT}
              hidden={Boolean(error)}
            >
              {hint}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          class={buttonClass("primary", "md", "w-full")}
          data-loading-text="Sending…"
        >
          Email me a reset link
        </button>
      </form>
    );
  }
}
