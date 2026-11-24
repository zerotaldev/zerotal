import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { AuthLayout } from "../../layouts/AuthLayout";
import { Page, titled } from "../../lib/page";

/**
 * GET /reset-password?token=…&email=… — the link from the email. The token and address
 * ride along with the new password, so the POST (app/routes/(guest)/reset-password.ts)
 * carries everything the server needs to check the link without trusting the session.
 */
export class ResetPasswordPage extends Page {
  static override title = titled("Choose a new password");

  token = "";
  email = "";

  override async onMount(): Promise<void> {
    const url = this.http ? new URL(this.http.request.url) : null;
    this.token = url?.searchParams.get("token") ?? this.token;
    this.email = url?.searchParams.get("email") ?? this.email;
  }

  override layout(page: HtmlNode): HtmlNode {
    return (
      <AuthLayout shell={this.shell()} title="Choose a new password">
        {page}
      </AuthLayout>
    );
  }

  override async render(): Promise<HtmlNode> {
    return (
      <form method="post" action={route("reset-password.store")} class="space-y-5">
        <input type="hidden" name="token" value={this.token} />
        <TextField
          label="Email"
          name="email"
          type="email"
          value={this.email}
          error={this.error("email")}
          readonly
        />

        <TextField
          label="New password"
          name="password"
          type="password"
          autocomplete="new-password"
          autofocus
          hint="At least 8 characters."
          error={this.error("password")}
          required
        />

        <TextField
          label="Confirm password"
          name="password_confirmation"
          type="password"
          autocomplete="new-password"
          error={this.error("password_confirmation")}
          required
        />

        <Button type="submit" class="w-full" data-loading-text="Saving…">
          Save new password
        </Button>
      </form>
    );
  }
}
