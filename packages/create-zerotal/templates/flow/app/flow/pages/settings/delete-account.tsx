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
  DIALOG_BUTTONS,
  FIELD,
  FIELD_ERROR,
  FIELD_LABEL_ROW,
  INPUT,
  LABEL,
  MODAL,
  MODAL_CLOSE,
  icon,
} from "../../lib/ui";

/** GET /settings/delete-account. The dialog DELETEs app/routes/(auth)/settings/delete-account.ts. */
export class DeleteAccountPage extends Page {
  static override title = titled("Delete account");

  override layout(page: HtmlNode): HtmlNode {
    return <SettingsLayout shell={this.shell()}>{page}</SettingsLayout>;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <>
        <div class={`${CARD} border-destructive/40`}>
          <div class={CARD_HEADER}>
            <div class="min-w-0">
              <h2 class={CARD_TITLE}>Delete account</h2>
              <p class={CARD_DESCRIPTION}>
                Your account and everything in it — projects, passkeys, sessions — is removed for
                good. There is no undo.
              </p>
            </div>
          </div>
          <div class={`${CARD_FOOTER} mt-5 border-destructive/20 bg-destructive/5`}>
            <button
              type="button"
              class={buttonClass("danger", "md")}
              data-open-modal="delete-account"
            >
              Delete my account
            </button>
          </div>
        </div>

        <dialog
          id="delete-account"
          data-modal=""
          aria-labelledby="delete-account-title"
          aria-describedby="delete-account-description"
          class={MODAL}
        >
          <div class="p-5 sm:p-6">
            <div class="flex items-start justify-between gap-4">
              <h2 id="delete-account-title" class="text-lg font-semibold">
                Delete your account?
              </h2>
              <button type="button" data-close-modal="" aria-label="Close" class={MODAL_CLOSE}>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  class="size-4.5"
                  dangerouslySetInnerHTML={icon("close")}
                />
              </button>
            </div>
            <p id="delete-account-description" class="mt-1.5 text-sm text-muted-foreground">
              This cannot be undone. Enter your password to confirm.
            </p>
            <div class="mt-5">
              <form
                method="post"
                action={route("settings.delete-account.destroy")}
                data-method="delete"
                class="space-y-5"
              >
                {CsrfMiddleware.field()}
                <div class={FIELD}>
                  <div class={FIELD_LABEL_ROW}>
                    <label for="delete-account-password" class={LABEL}>
                      Password
                    </label>
                  </div>
                  <input
                    class={INPUT}
                    type="password"
                    autocomplete="current-password"
                    autofocus
                    required
                    id="delete-account-password"
                    name="password"
                  />
                  <p
                    id="delete-account-password-error"
                    data-error-for="password"
                    class={FIELD_ERROR}
                    hidden
                  ></p>
                </div>
                <div class={DIALOG_BUTTONS}>
                  <button type="button" class={buttonClass("secondary", "md")} data-close-modal="">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    class={buttonClass("danger", "md")}
                    data-loading-text="Deleting…"
                  >
                    Delete account
                  </button>
                </div>
              </form>
            </div>
          </div>
        </dialog>
      </>
    );
  }
}
