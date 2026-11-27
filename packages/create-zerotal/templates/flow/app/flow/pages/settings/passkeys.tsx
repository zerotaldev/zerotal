import { route } from "zerotal";
import { CsrfMiddleware } from "zerotal/session";
import type { HtmlNode } from "@zerotal/flow";
import { listPasskeys, type PasskeySummary } from "@app/auth/passkeys";
import { SettingsLayout } from "../../layouts/SettingsLayout";
import { buttonClass } from "../../lib/button";
import { formatDate, timeAgo } from "../../lib/format";
import { Page, titled } from "../../lib/page";
import {
  ALERT_BODY,
  ALERT_ICON_CLASS,
  ALERT_TEXT_UNDER_TITLE,
  ALERT_TITLE,
  CARD,
  CARD_ACTIONS,
  CARD_DESCRIPTION,
  CARD_HEADER,
  CARD_TITLE,
  EMPTY_DESCRIPTION,
  EMPTY_ICON,
  EMPTY_STATE,
  EMPTY_TITLE,
  FIELD,
  FIELD_ERROR,
  FIELD_LABEL_ROW,
  INPUT,
  LABEL,
  MODAL,
  MODAL_CLOSE,
  MODAL_FOOTER,
  alertClass,
  badgeClass,
  icon,
} from "../../lib/ui";

/**
 * GET /settings/passkeys — only when PASSKEY_RP_ID is set.
 *
 * Adding one is a ceremony between the browser and the server, so it is the browser
 * script's job (resources/js/lib/passkey-ui.ts): it asks app/routes/(auth)/settings/
 * passkeys/options.ts for a challenge, has the device make the passkey, and posts it to
 * app/routes/(auth)/settings/passkeys/index.ts. Removing one is an ordinary DELETE.
 */
export class PasskeysPage extends Page {
  static override title = titled("Passkeys");

  passkeys: PasskeySummary[] = [];

  override async onMount(): Promise<void> {
    if (this.user) this.passkeys = await listPasskeys(this.user.id);
  }

  override layout(page: HtmlNode): HtmlNode {
    return <SettingsLayout shell={this.shell()}>{page}</SettingsLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const passkeys = this.passkeys;

    return (
      <>
        <div data-passkey-unsupported="" hidden>
          <div role="alert" class={alertClass("warning")}>
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              class={ALERT_ICON_CLASS}
              dangerouslySetInnerHTML={icon("alert")}
            />
            <div class={ALERT_BODY}>
              <p class={ALERT_TITLE}>This browser can't use passkeys</p>
              <div class={ALERT_TEXT_UNDER_TITLE}>
                Try a recent version of Chrome, Safari, Edge or Firefox.
              </div>
            </div>
          </div>
        </div>

        <div class={CARD}>
          <div class={CARD_HEADER}>
            <div class="min-w-0">
              <h2 class={CARD_TITLE}>Passkeys</h2>
              <p class={CARD_DESCRIPTION}>
                Sign in with your fingerprint, face or device PIN instead of a password.
              </p>
            </div>
            {passkeys.length > 0 ? (
              <div class={CARD_ACTIONS}>
                <button
                  type="button"
                  class={buttonClass("primary", "sm")}
                  data-open-modal="add-passkey"
                  data-passkey-requires-support=""
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    class="size-4"
                    dangerouslySetInnerHTML={icon("plus")}
                  />
                  Add a passkey
                </button>
              </div>
            ) : null}
          </div>

          <div class="p-5 sm:p-6">
            {passkeys.length === 0 ? (
              <div class={EMPTY_STATE}>
                <div class={EMPTY_ICON}>
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    class="size-6"
                    dangerouslySetInnerHTML={icon("fingerprint")}
                  />
                </div>
                <h3 class={EMPTY_TITLE}>No passkeys yet</h3>
                <p class={EMPTY_DESCRIPTION}>
                  A passkey lives on your phone, laptop or security key. Nothing to remember,
                  nothing to type.
                </p>
                <div class="mt-6">
                  <button
                    type="button"
                    class={buttonClass("primary", "md")}
                    data-open-modal="add-passkey"
                    data-passkey-requires-support=""
                  >
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      class="size-4"
                      dangerouslySetInnerHTML={icon("plus")}
                    />
                    Add a passkey
                  </button>
                </div>
              </div>
            ) : (
              <ul class="divide-y divide-border rounded-xl border border-border">
                {passkeys.map((passkey) => {
                  const added = formatDate(passkey.createdAt);
                  const used = timeAgo(passkey.lastUsedAt);
                  return (
                    <li key={String(passkey.id)} class="flex items-center gap-4 p-4">
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        class="size-5 shrink-0 text-muted-foreground"
                        dangerouslySetInnerHTML={icon("fingerprint")}
                      />
                      <div class="min-w-0 flex-1">
                        <p class="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {passkey.name}
                          {passkey.backedUp ? (
                            <span class={badgeClass("primary")}>Synced</span>
                          ) : null}
                        </p>
                        <p class="text-sm text-muted-foreground">
                          Added {added} · Last used {used}
                        </p>
                      </div>
                      <button
                        type="button"
                        class={buttonClass("ghost", "sm")}
                        data-open-modal={`remove-passkey-${passkey.id}`}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <dialog
          id="add-passkey"
          data-modal=""
          aria-labelledby="add-passkey-title"
          aria-describedby="add-passkey-description"
          class={MODAL}
        >
          <div class="p-5 sm:p-6">
            <div class="flex items-start justify-between gap-4">
              <h2 id="add-passkey-title" class="text-lg font-semibold">
                Add a passkey
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
            <p id="add-passkey-description" class="mt-1.5 text-sm text-muted-foreground">
              Give it a name you'll recognise. Your browser will then ask you to confirm it's you.
            </p>
            <div class="mt-5">
              <form data-passkey-register="" class="space-y-5">
                <div class={FIELD}>
                  <div class={FIELD_LABEL_ROW}>
                    <label for="passkey-name" class={LABEL}>
                      Name
                    </label>
                  </div>
                  <input
                    class={INPUT}
                    maxlength="60"
                    data-suggest-passkey-name=""
                    required
                    id="passkey-name"
                    name="name"
                  />
                  <p id="passkey-name-error" data-error-for="name" class={FIELD_ERROR} hidden></p>
                </div>
                <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" class={buttonClass("secondary", "md")} data-close-modal="">
                    Cancel
                  </button>
                  <button type="submit" class={buttonClass("primary", "md")}>
                    Continue
                  </button>
                </div>
              </form>
            </div>
          </div>
        </dialog>

        {passkeys.map((passkey) => {
          const id = `remove-passkey-${passkey.id}`;
          return (
            <dialog
              id={id}
              data-modal=""
              aria-labelledby={`${id}-title`}
              aria-describedby={`${id}-description`}
              class={MODAL}
            >
              <div class="p-5 sm:p-6">
                <div class="flex items-start justify-between gap-4">
                  <h2
                    id={`${id}-title`}
                    class="text-lg font-semibold"
                  >{`Remove “${passkey.name}”?`}</h2>
                  <button type="button" data-close-modal="" aria-label="Close" class={MODAL_CLOSE}>
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      class="size-4.5"
                      dangerouslySetInnerHTML={icon("close")}
                    />
                  </button>
                </div>
                <p id={`${id}-description`} class="mt-1.5 text-sm text-muted-foreground">
                  It will no longer sign you in. You can add it again later.
                </p>
              </div>
              <div class={MODAL_FOOTER}>
                <>
                  <button type="button" class={buttonClass("secondary", "md")} data-close-modal="">
                    Cancel
                  </button>
                  {/* DELETE, which a browser form can't send alone: see resources/js/lib/forms.ts. */}
                  <form
                    method="post"
                    action={route("settings.passkeys.destroy", { passkey: passkey.id })}
                    data-method="delete"
                  >
                    {CsrfMiddleware.field()}
                    <button
                      type="submit"
                      class={buttonClass("danger", "md", "w-full")}
                      data-loading-text="Removing…"
                    >
                      Remove
                    </button>
                  </form>
                </>
              </div>
            </dialog>
          );
        })}
      </>
    );
  }
}
