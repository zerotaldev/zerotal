import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { mailIsLogged } from "@app/support/mail";
import { AuthLayout } from "../../layouts/AuthLayout";
import { buttonClass } from "../../lib/button";
import { Page, titled } from "../../lib/page";
import { icon } from "../../lib/ui";

/**
 * GET /verify-email — "check your inbox", until the link has been clicked. Asking for the
 * link again posts to app/routes/(auth)/verify-email/index.ts.
 */
export class VerifyEmailPage extends Page {
  static override title = titled("Verify your email");

  override async onMount(): Promise<void> {
    if (this.user?.hasVerifiedEmail()) this.redirect("/dashboard");
  }

  override layout(page: HtmlNode): HtmlNode {
    return (
      <AuthLayout
        shell={this.shell()}
        title="Check your inbox"
        description="One more step: confirm your email address."
        footer={
          <form method="post" action={route("logout.store")}>
            <button type="submit" class="font-medium text-primary hover:underline">
              Sign out
            </button>
          </form>
        }
      >
        {page}
      </AuthLayout>
    );
  }

  override async render(): Promise<HtmlNode> {
    return (
      <>
        <div class="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            class="mt-0.5 size-5 shrink-0 text-primary"
            dangerouslySetInnerHTML={icon("mail")}
          />
          <p class="text-sm text-muted-foreground">
            We sent a link to{" "}
            <span class="font-medium text-foreground">{this.user?.email ?? ""}</span>. Open it on
            this device to confirm the address. The link expires in an hour.
          </p>
        </div>

        {/* Mail is printed by the server rather than sent (MAIL_DRIVER=log). */}
        {mailIsLogged() ? (
          <p class="mt-4 text-sm text-muted-foreground">
            Working locally? The mail driver is <code class="font-mono text-foreground">log</code>,
            so the message — link included — is printed in the terminal running the server.
          </p>
        ) : null}

        <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <form method="post" action={route("verify-email.store")}>
            <button type="submit" class={buttonClass()} data-loading-text="Sending…">
              Send the link again
            </button>
          </form>
          <a
            href={route("settings.profile")}
            class="text-sm font-medium text-primary hover:underline"
          >
            Wrong address? Change it
          </a>
        </div>
      </>
    );
  }
}
