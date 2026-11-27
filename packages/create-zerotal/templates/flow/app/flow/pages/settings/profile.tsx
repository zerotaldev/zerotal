import { route } from "zerotal";
import { CsrfMiddleware } from "zerotal/session";
import type { HtmlNode } from "@zerotal/flow";
import { SettingsLayout } from "../../layouts/SettingsLayout";
import { buttonClass } from "../../lib/button";
import { Page, titled } from "../../lib/page";
import {
  ALERT_BODY,
  ALERT_ICON_CLASS,
  ALERT_TEXT_UNDER_TITLE,
  ALERT_TITLE,
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
  alertClass,
  icon,
} from "../../lib/ui";

/** GET /settings/profile. The form PATCHes app/routes/(auth)/settings/profile.ts. */
export class ProfilePage extends Page {
  static override title = titled("Profile");

  override layout(page: HtmlNode): HtmlNode {
    return <SettingsLayout shell={this.shell()}>{page}</SettingsLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const user = this.user;
    const name = this.old("name", user?.name ?? "");
    const email = this.old("email", user?.email ?? "");
    const nameError = this.error("name");
    const emailError = this.error("email");

    return (
      <>
        {user && !user.hasVerifiedEmail() ? (
          <div role="alert" class={alertClass("warning")}>
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              class={ALERT_ICON_CLASS}
              dangerouslySetInnerHTML={icon("alert")}
            />
            <div class={ALERT_BODY}>
              <p class={ALERT_TITLE}>Your email address is not confirmed yet</p>
              <div class={ALERT_TEXT_UNDER_TITLE}>
                Until it is, the dashboard and projects stay locked. Check your inbox for the link.
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <form method="post" action={route("verify-email.store")}>
                  {CsrfMiddleware.field()}
                  <button
                    type="submit"
                    class={buttonClass("secondary", "sm")}
                    data-loading-text="Sending…"
                  >
                    Send the link again
                  </button>
                </form>
              </div>
            </div>
          </div>
        ) : null}

        <div class={CARD}>
          {/* PATCH, which a browser form can't send alone: see resources/js/lib/forms.ts. */}
          <form method="post" action={route("settings.profile.update")} data-method="patch">
            {CsrfMiddleware.field()}
            <div class={CARD_HEADER}>
              <div class="min-w-0">
                <h2 class={CARD_TITLE}>Profile</h2>
                <p class={CARD_DESCRIPTION}>Your name, and the address we email.</p>
              </div>
            </div>
            <div class={`${CARD_BODY} space-y-5`}>
              <div class={FIELD}>
                <div class={FIELD_LABEL_ROW}>
                  <label for="field-name" class={LABEL}>
                    Name
                  </label>
                </div>
                <input
                  class={INPUT}
                  autocomplete="name"
                  value={name}
                  required
                  id="field-name"
                  name="name"
                  aria-invalid={nameError ? "true" : undefined}
                  aria-describedby={nameError ? "field-name-error" : undefined}
                />
                <p
                  id="field-name-error"
                  data-error-for="name"
                  class={FIELD_ERROR}
                  hidden={!nameError}
                >
                  {nameError}
                </p>
              </div>
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
                  value={email}
                  required
                  id="field-email"
                  name="email"
                  aria-invalid={emailError ? "true" : undefined}
                  aria-describedby={emailError ? "field-email-error" : "field-email-hint"}
                />
                <p
                  id="field-email-error"
                  data-error-for="email"
                  class={FIELD_ERROR}
                  hidden={!emailError}
                >
                  {emailError}
                </p>
                <p
                  id="field-email-hint"
                  data-hint-for="email"
                  class={FIELD_HINT}
                  hidden={Boolean(emailError)}
                >
                  Changing it sends a link to the new address to confirm it.
                </p>
              </div>
            </div>
            <div class={CARD_FOOTER}>
              <button
                type="submit"
                class={buttonClass("primary", "md")}
                data-loading-text="Saving…"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      </>
    );
  }
}
