import { route } from "zerotal";
import { CsrfMiddleware } from "zerotal/session";
import type { HtmlNode } from "@zerotal/flow";
import { SettingsLayout } from "../../layouts/SettingsLayout";
import { buttonClass } from "../../lib/button";
import { Page, titled } from "../../lib/page";
import {
  CARD,
  CARD_BODY,
  CARD_DESCRIPTION,
  CARD_FOOTER,
  CARD_HEADER,
  CARD_TITLE,
  FIELD,
  FIELD_ERROR,
  FIELD_HINT,
  FIELD_LABEL_ROW,
  INPUT,
  LABEL,
} from "../../lib/ui";

/** GET /settings/password. The form PUTs to app/routes/(auth)/settings/password.ts. */
export class PasswordPage extends Page {
  static override title = titled("Password");

  override layout(page: HtmlNode): HtmlNode {
    return <SettingsLayout shell={this.shell()}>{page}</SettingsLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const currentError = this.error("current_password");
    const passwordError = this.error("password");
    const confirmationError = this.error("password_confirmation");

    return (
      <div class={CARD}>
        {/* PUT, which a browser form can't send alone: see resources/js/lib/forms.ts. */}
        <form method="post" action={route("settings.password.update")} data-method="put">
          {CsrfMiddleware.field()}
          <div class={CARD_HEADER}>
            <div class="min-w-0">
              <h2 class={CARD_TITLE}>Change password</h2>
              <p class={CARD_DESCRIPTION}>Changing it signs you out on every other device.</p>
            </div>
          </div>
          <div class={`${CARD_BODY} space-y-5`}>
            <div class={FIELD}>
              <div class={FIELD_LABEL_ROW}>
                <label for="field-current_password" class={LABEL}>
                  Current password
                </label>
              </div>
              <input
                class={INPUT}
                type="password"
                autocomplete="current-password"
                required
                id="field-current_password"
                name="current_password"
                aria-invalid={currentError ? "true" : undefined}
                aria-describedby={currentError ? "field-current_password-error" : undefined}
              />
              <p
                id="field-current_password-error"
                data-error-for="current_password"
                class={FIELD_ERROR}
                hidden={!currentError}
              >
                {currentError}
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
                  Confirm new password
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
                aria-describedby={
                  confirmationError ? "field-password_confirmation-error" : undefined
                }
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
          </div>
          <div class={CARD_FOOTER}>
            <button type="submit" class={buttonClass("primary", "md")} data-loading-text="Saving…">
              Change password
            </button>
          </div>
        </form>
      </div>
    );
  }
}
