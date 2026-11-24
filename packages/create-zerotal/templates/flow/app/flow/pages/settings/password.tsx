import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { Button } from "../../components/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../components/Card";
import { TextField } from "../../components/Field";
import { SettingsLayout } from "../../layouts/SettingsLayout";
import { Page, titled } from "../../lib/page";

/** GET /settings/password. The form PUTs to app/routes/(auth)/settings/password.ts. */
export class PasswordPage extends Page {
  static override title = titled("Password");

  override layout(page: HtmlNode): HtmlNode {
    return <SettingsLayout shell={this.shell()}>{page}</SettingsLayout>;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <Card>
        {/* PUT, which a browser form can't send alone: see resources/js/lib/forms.ts. */}
        <form method="post" action={route("settings.password.update")} data-method="put">
          <CardHeader
            title="Change password"
            description="Changing it signs you out on every other device."
          />
          <CardBody class="space-y-5">
            <TextField
              label="Current password"
              name="current_password"
              type="password"
              autocomplete="current-password"
              error={this.error("current_password")}
              required
            />
            <TextField
              label="New password"
              name="password"
              type="password"
              autocomplete="new-password"
              hint="At least 8 characters."
              error={this.error("password")}
              required
            />
            <TextField
              label="Confirm new password"
              name="password_confirmation"
              type="password"
              autocomplete="new-password"
              error={this.error("password_confirmation")}
              required
            />
          </CardBody>
          <CardFooter>
            <Button type="submit" data-loading-text="Saving…">
              Change password
            </Button>
          </CardFooter>
        </form>
      </Card>
    );
  }
}
