import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { AuthLayout } from "../../layouts/AuthLayout";
import { buttonClass } from "../../lib/button";
import { Page, titled } from "../../lib/page";
import { FIELD, FIELD_ERROR, FIELD_LABEL_ROW, INPUT, LABEL } from "../../lib/ui";

/**
 * GET /confirm-password — "Confirm your password to continue."
 *
 * `ConfirmPasswordMiddleware` sends a user here before a sensitive page — two-factor and
 * passkey settings — unless they entered their password in the last three hours. The
 * form posts to app/routes/(auth)/confirm-password.ts.
 */
export class ConfirmPasswordPage extends Page {
  static override title = titled("Confirm your password");

  override layout(page: HtmlNode): HtmlNode {
    return (
      <AuthLayout
        shell={this.shell()}
        title="Confirm your password"
        description="This is a secure area. Enter your password to continue — you won't be asked again for a few hours."
        footer={
          <a href={route("settings")} class="font-medium text-primary hover:underline">
            Back to settings
          </a>
        }
      >
        {page}
      </AuthLayout>
    );
  }

  override async render(): Promise<HtmlNode> {
    const error = this.error("password");

    return (
      <form method="post" action={route("confirm-password.store")} class="space-y-5">
        <div class={FIELD}>
          <div class={FIELD_LABEL_ROW}>
            <label for="field-password" class={LABEL}>
              Password
            </label>
          </div>
          <input
            class={INPUT}
            type="password"
            autocomplete="current-password"
            autofocus
            required
            id="field-password"
            name="password"
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "field-password-error" : undefined}
          />
          <p
            id="field-password-error"
            data-error-for="password"
            class={FIELD_ERROR}
            hidden={!error}
          >
            {error}
          </p>
        </div>
        <button
          type="submit"
          class={buttonClass("primary", "md", "w-full")}
          data-loading-text="Checking…"
        >
          Confirm
        </button>
      </form>
    );
  }
}
