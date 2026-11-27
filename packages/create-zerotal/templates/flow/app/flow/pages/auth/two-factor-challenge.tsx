import { route } from "zerotal";
import { CsrfMiddleware } from "zerotal/session";
import { Auth } from "zerotal/auth";
import type { HtmlNode } from "@zerotal/flow";
import { AuthLayout } from "../../layouts/AuthLayout";
import { buttonClass } from "../../lib/button";
import { Page, titled } from "../../lib/page";
import { FIELD, FIELD_ERROR, FIELD_HINT, FIELD_LABEL_ROW, INPUT, LABEL } from "../../lib/ui";

/**
 * GET /two-factor/challenge — the second step of signing in, for an account with
 * two-factor on. The password was right, but `Auth.login()` left the session pending
 * until a code arrives; the form posts it to app/routes/(guest)/two-factor/challenge.ts.
 *
 * A lost phone is what recovery codes are for, so the form offers both. Only the field
 * on show is sent: the other is disabled (resources/js/lib/actions.ts, `data-swap`).
 */
export class TwoFactorChallengePage extends Page {
  static override title = titled("Two-factor authentication");

  override async onMount(): Promise<void> {
    // Nobody is half-way through signing in: start at the beginning.
    if (!Auth.pendingTwoFactorUser()) this.redirect("/login");
  }

  override layout(page: HtmlNode): HtmlNode {
    return (
      <AuthLayout
        shell={this.shell()}
        title="Two-factor authentication"
        description="Enter the six-digit code from your authenticator app."
        footer={
          <a href={route("login")} class="font-medium text-primary hover:underline">
            Sign in as someone else
          </a>
        }
      >
        {page}
      </AuthLayout>
    );
  }

  override async render(): Promise<HtmlNode> {
    const codeError = this.error("code");
    const recoveryError = this.error("recovery_code");
    // A failed recovery code comes back showing the recovery field, not the code field.
    const recovery = recoveryError !== undefined;

    return (
      <form method="post" action={route("two-factor.challenge.store")} class="space-y-5">
        {CsrfMiddleware.field()}
        <div data-swap-panel="two-factor" hidden={recovery}>
          <div class={FIELD}>
            <div class={FIELD_LABEL_ROW}>
              <label for="field-code" class={LABEL}>
                Authentication code
              </label>
            </div>
            <input
              class={`${INPUT} text-center font-mono text-lg tracking-[0.4em]`}
              inputmode="numeric"
              autocomplete="one-time-code"
              autofocus={!recovery}
              maxlength="7"
              placeholder="123456"
              disabled={recovery}
              required
              id="field-code"
              name="code"
              aria-invalid={codeError ? "true" : undefined}
              aria-describedby={codeError ? "field-code-error" : undefined}
            />
            <p id="field-code-error" data-error-for="code" class={FIELD_ERROR} hidden={!codeError}>
              {codeError}
            </p>
          </div>
          <button
            type="button"
            data-swap="two-factor"
            class="mt-5 w-full text-center text-sm font-medium text-primary hover:underline"
          >
            Lost your phone? Use a recovery code
          </button>
        </div>

        <div data-swap-panel="two-factor" hidden={!recovery}>
          <div class={FIELD}>
            <div class={FIELD_LABEL_ROW}>
              <label for="field-recovery_code" class={LABEL}>
                Recovery code
              </label>
            </div>
            <input
              class={INPUT}
              autocomplete="off"
              autofocus={recovery}
              spellcheck="false"
              disabled={!recovery}
              required
              id="field-recovery_code"
              name="recovery_code"
              aria-invalid={recoveryError ? "true" : undefined}
              aria-describedby={
                recoveryError ? "field-recovery_code-error" : "field-recovery_code-hint"
              }
            />
            <p
              id="field-recovery_code-error"
              data-error-for="recovery_code"
              class={FIELD_ERROR}
              hidden={!recoveryError}
            >
              {recoveryError}
            </p>
            <p
              id="field-recovery_code-hint"
              data-hint-for="recovery_code"
              class={FIELD_HINT}
              hidden={Boolean(recoveryError)}
            >
              One of the codes you saved when you turned two-factor on. Each works once.
            </p>
          </div>
          <button
            type="button"
            data-swap="two-factor"
            class="mt-5 w-full text-center text-sm font-medium text-primary hover:underline"
          >
            Use a code from my app instead
          </button>
        </div>

        <button
          type="submit"
          class={buttonClass("primary", "md", "w-full")}
          data-loading-text="Checking…"
        >
          Continue
        </button>
      </form>
    );
  }
}
