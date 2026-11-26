import { route } from "zerotal";
import { TwoFactor } from "zerotal/auth";
import type { HtmlNode } from "@zerotal/flow";
import { RECOVERY_CODES_FLASH, SETUP_SECRET_KEY } from "@app/auth/two-factor";
import { SettingsLayout } from "../../layouts/SettingsLayout";
import { buttonClass } from "../../lib/button";
import { Page, titled } from "../../lib/page";
import {
  ALERT_BODY,
  ALERT_ICON_CLASS,
  ALERT_TEXT_UNDER_TITLE,
  ALERT_TITLE,
  CARD,
  CARD_ACTIONS,
  CARD_BODY,
  CARD_DESCRIPTION,
  CARD_FOOTER,
  CARD_HEADER,
  CARD_TITLE,
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

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP", easier to type off a screen. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * GET /settings/two-factor.
 *
 * Turning it on takes two steps, so a half-finished setup can never lock anyone out:
 * "Set up two-factor" posts to app/routes/(auth)/settings/two-factor/index.ts, which
 * makes a secret and keeps it in the session while this page shows the QR code; only
 * /settings/two-factor/confirm, given a working code from the app, saves it to the user.
 */
export class TwoFactorPage extends Page {
  static override title = titled("Two-factor authentication");

  enabled = false;
  /** Present while setting up: the QR code, and the same secret as text and as a link. */
  setup: { qrSvg: string; uri: string; secret: string } | null = null;
  /** Present once, straight after codes are made. */
  recoveryCodes: string[] | null = null;
  recoveryCodesLeft = 0;

  override async onMount(): Promise<void> {
    const user = this.user;
    if (!user) return;
    this.enabled = user.hasTwoFactorEnabled();

    const pending = this.enabled ? undefined : this.http?.session?.get(SETUP_SECRET_KEY);
    // The QR code is drawn on the server as inline SVG — the secret is never sent to an
    // image service — and the secret is shown as text for typing in by hand.
    if (typeof pending === "string") {
      this.setup = {
        qrSvg: TwoFactor.getQrCodeSvg(user.email, pending, { size: 192 }),
        uri: TwoFactor.getQrCodeUrl(user.email, pending),
        secret: pending,
      };
    }
    // Shown once, straight after they are made, and never again.
    this.recoveryCodes =
      (this.http?.session?.get(RECOVERY_CODES_FLASH) as string[] | undefined) ?? null;
    this.recoveryCodesLeft = this.enabled ? user.recoveryCodeHashes().length : 0;
  }

  override layout(page: HtmlNode): HtmlNode {
    return <SettingsLayout shell={this.shell()}>{page}</SettingsLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const { enabled, setup, recoveryCodes, recoveryCodesLeft } = this;
    const secret = setup ? grouped(setup.secret) : "";
    const codeError = this.error("code");

    return (
      <>
        {recoveryCodes ? (
          <div role="alert" class={alertClass("warning")}>
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              class={ALERT_ICON_CLASS}
              dangerouslySetInnerHTML={icon("alert")}
            />
            <div class={ALERT_BODY}>
              <p class={ALERT_TITLE}>Save these recovery codes now</p>
              <div class={ALERT_TEXT_UNDER_TITLE}>
                <p>
                  Each one signs you in once if you lose your phone. Keep them in a password
                  manager. They will not be shown again.
                </p>
                <ul class="mt-3 space-y-1 font-mono text-sm break-all text-foreground">
                  {recoveryCodes.map((code) => (
                    <li data-recovery-code="">{code}</li>
                  ))}
                </ul>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  class={buttonClass("secondary", "sm")}
                  data-copy={recoveryCodes.join("\n")}
                  data-copied="Recovery codes copied."
                >
                  Copy codes
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div class={CARD}>
          <div class={CARD_HEADER}>
            <div class="min-w-0">
              <h2 class={CARD_TITLE}>Two-factor authentication</h2>
              <p class={CARD_DESCRIPTION}>
                Ask for a code from your phone, as well as your password, when you sign in.
              </p>
            </div>
            <div class={CARD_ACTIONS}>
              <span data-two-factor-status="">
                {enabled ? (
                  <span class={badgeClass("success")}>On</span>
                ) : (
                  <span class={badgeClass()}>Off</span>
                )}
              </span>
            </div>
          </div>

          {enabled ? (
            <>
              <div class={`${CARD_BODY} space-y-2 text-sm text-muted-foreground`}>
                <p>
                  Signing in asks for the six-digit code from your authenticator app. You have{" "}
                  <span class="font-medium text-foreground">{recoveryCodesLeft}</span> unused
                  recovery code{recoveryCodesLeft === 1 ? "" : "s"} for when your phone is not to
                  hand.
                </p>
              </div>
              <div class={`${CARD_FOOTER} justify-between`}>
                <form method="post" action={route("settings.two-factor.recovery-codes.store")}>
                  <button type="submit" class={buttonClass("secondary", "md")}>
                    Make new recovery codes
                  </button>
                </form>
                <button
                  type="button"
                  class={buttonClass("danger", "md")}
                  data-open-modal="turn-off-two-factor"
                >
                  Turn off
                </button>
              </div>
            </>
          ) : setup ? (
            <>
              <form method="post" action={route("settings.two-factor.confirm.store")}>
                <div class={`${CARD_BODY} space-y-6`}>
                  <ol class="space-y-6 text-sm">
                    <li>
                      <p class="font-medium">1. Scan this with your authenticator app</p>
                      <p class="mt-1 text-muted-foreground">
                        1Password, Google Authenticator, Authy, Bitwarden — any app for six-digit
                        codes.
                      </p>
                      <div class="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
                        {/* Drawn on the server, from data that never leaves it. Inline on purpose. */}
                        <div
                          class="w-fit shrink-0 rounded-xl border border-border bg-white p-2"
                          dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
                        />
                        <div class="min-w-0 space-y-2 text-muted-foreground">
                          <p>Can't scan it? Type this key into the app instead:</p>
                          <p
                            class="font-mono text-base break-all text-foreground select-all"
                            data-two-factor-secret=""
                          >
                            {secret}
                          </p>
                          <p>
                            On your phone already?{" "}
                            <a href={setup.uri} class="font-medium text-primary hover:underline">
                              Open it in your authenticator app
                            </a>
                            .
                          </p>
                        </div>
                      </div>
                    </li>
                    <li>
                      <p class="font-medium">2. Enter the code the app shows</p>
                      <div class="mt-3 max-w-xs">
                        <div class={FIELD}>
                          <div class={FIELD_LABEL_ROW}>
                            <label for="field-code" class={LABEL}>
                              Code
                            </label>
                          </div>
                          <input
                            class={`${INPUT} font-mono tracking-[0.3em]`}
                            inputmode="numeric"
                            autocomplete="one-time-code"
                            maxlength="7"
                            placeholder="123456"
                            required
                            id="field-code"
                            name="code"
                            aria-invalid={codeError ? "true" : undefined}
                            aria-describedby={codeError ? "field-code-error" : undefined}
                          />
                          <p
                            id="field-code-error"
                            data-error-for="code"
                            class={FIELD_ERROR}
                            hidden={!codeError}
                          >
                            {codeError}
                          </p>
                        </div>
                      </div>
                    </li>
                  </ol>
                </div>
                <div class={CARD_FOOTER}>
                  {/* Abandons the setup: the same DELETE as turning it off. It submits the
                    form below rather than this one, so it is not this form's default
                    button — pressing Enter in the code field turns two-factor on. */}
                  <button
                    type="submit"
                    class={buttonClass("ghost", "md")}
                    form="cancel-two-factor-setup"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    class={buttonClass("primary", "md")}
                    data-loading-text="Checking…"
                  >
                    Turn on
                  </button>
                </div>
              </form>
              <form
                id="cancel-two-factor-setup"
                method="post"
                action={route("settings.two-factor.destroy")}
                data-method="delete"
                hidden
              />
            </>
          ) : (
            <>
              <div class={`${CARD_BODY} text-sm text-muted-foreground`}>
                Even with your password, nobody can sign in without your phone. You'll get recovery
                codes for the day you don't have it.
              </div>
              <div class={CARD_FOOTER}>
                <form method="post" action={route("settings.two-factor.store")}>
                  <button type="submit" class={buttonClass("primary", "md")}>
                    Set up two-factor
                  </button>
                </form>
              </div>
            </>
          )}
        </div>

        <dialog
          id="turn-off-two-factor"
          data-modal=""
          aria-labelledby="turn-off-two-factor-title"
          aria-describedby="turn-off-two-factor-description"
          class={MODAL}
        >
          <div class="p-5 sm:p-6">
            <div class="flex items-start justify-between gap-4">
              <h2 id="turn-off-two-factor-title" class="text-lg font-semibold">
                Turn off two-factor?
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
            <p id="turn-off-two-factor-description" class="mt-1.5 text-sm text-muted-foreground">
              Signing in will need only your password. Your recovery codes stop working.
            </p>
          </div>
          <div class={MODAL_FOOTER}>
            <>
              <button type="button" class={buttonClass("secondary", "md")} data-close-modal="">
                Keep it on
              </button>
              {/* DELETE, which a browser form can't send alone: see resources/js/lib/forms.ts. */}
              <form
                method="post"
                action={route("settings.two-factor.destroy")}
                data-method="delete"
              >
                <button
                  type="submit"
                  class={buttonClass("danger", "md", "w-full")}
                  data-loading-text="Turning off…"
                >
                  Turn off
                </button>
              </form>
            </>
          </div>
        </dialog>
      </>
    );
  }
}
