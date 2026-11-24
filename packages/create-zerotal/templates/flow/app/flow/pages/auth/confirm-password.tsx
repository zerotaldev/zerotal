import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { AuthLayout } from "../../layouts/AuthLayout";
import { Page, titled } from "../../lib/page";

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
    return (
      <form method="post" action={route("confirm-password.store")} class="space-y-5">
        <TextField
          label="Password"
          name="password"
          type="password"
          autocomplete="current-password"
          autofocus
          error={this.error("password")}
          required
        />

        <Button type="submit" class="w-full" data-loading-text="Checking…">
          Confirm
        </Button>
      </form>
    );
  }
}
