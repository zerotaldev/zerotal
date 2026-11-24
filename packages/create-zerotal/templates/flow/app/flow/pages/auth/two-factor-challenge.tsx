import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { Auth } from "zerotal/auth";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { AuthLayout } from "../../layouts/AuthLayout";
import { Page, titled } from "../../lib/page";

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
    // A failed recovery code comes back showing the recovery field, not the code field.
    const recovery = this.error("recovery_code") !== undefined;

    return (
      <form method="post" action={route("two-factor.challenge.store")} class="space-y-5">
        <div data-swap-panel="two-factor" hidden={recovery}>
          <TextField
            label="Authentication code"
            name="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            autofocus={!recovery}
            maxlength="7"
            placeholder="123456"
            class="text-center font-mono text-lg tracking-[0.4em]"
            error={this.error("code")}
            disabled={recovery}
            required
          />
          <button
            type="button"
            data-swap="two-factor"
            class="mt-5 w-full text-center text-sm font-medium text-primary hover:underline"
          >
            Lost your phone? Use a recovery code
          </button>
        </div>

        <div data-swap-panel="two-factor" hidden={!recovery}>
          <TextField
            label="Recovery code"
            name="recovery_code"
            autocomplete="off"
            autofocus={recovery}
            spellcheck="false"
            hint="One of the codes you saved when you turned two-factor on. Each works once."
            error={this.error("recovery_code")}
            disabled={!recovery}
            required
          />
          <button
            type="button"
            data-swap="two-factor"
            class="mt-5 w-full text-center text-sm font-medium text-primary hover:underline"
          >
            Use a code from my app instead
          </button>
        </div>

        <Button type="submit" class="w-full" data-loading-text="Checking…">
          Continue
        </Button>
      </form>
    );
  }
}
