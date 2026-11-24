import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { mailIsLogged } from "@app/support/mail";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { AuthLayout } from "../../layouts/AuthLayout";
import { Page, titled } from "../../lib/page";

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
    return (
      <form method="post" action={route("forgot-password.store")} class="space-y-5">
        <TextField
          label="Email"
          name="email"
          type="email"
          autocomplete="email"
          autofocus
          hint={
            // Mail is printed by the server rather than sent (MAIL_DRIVER=log).
            mailIsLogged()
              ? "Mail is printed in the terminal running the server, not sent (MAIL_DRIVER=log)."
              : undefined
          }
          value={this.old("email")}
          error={this.error("email")}
          required
        />

        <Button type="submit" class="w-full" data-loading-text="Sending…">
          Email me a reset link
        </Button>
      </form>
    );
  }
}
