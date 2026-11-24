import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { Button } from "../../components/Button";
import { Card, CardFooter, CardHeader } from "../../components/Card";
import { PasswordDialog } from "../../components/PasswordDialog";
import { SettingsLayout } from "../../layouts/SettingsLayout";
import { Page, titled } from "../../lib/page";

/** GET /settings/delete-account. The dialog DELETEs app/routes/(auth)/settings/delete-account.ts. */
export class DeleteAccountPage extends Page {
  static override title = titled("Delete account");

  override layout(page: HtmlNode): HtmlNode {
    return <SettingsLayout shell={this.shell()}>{page}</SettingsLayout>;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <>
        <Card class="border-destructive/40">
          <CardHeader
            title="Delete account"
            description="Your account and everything in it — projects, passkeys, sessions — is removed for good. There is no undo."
          />
          <CardFooter class="mt-5 border-destructive/20 bg-destructive/5">
            <Button variant="danger" data-open-modal="delete-account">
              Delete my account
            </Button>
          </CardFooter>
        </Card>

        <PasswordDialog
          id="delete-account"
          title="Delete your account?"
          description="This cannot be undone. Enter your password to confirm."
          method="delete"
          url={route("settings.delete-account.destroy")}
          confirmLabel="Delete account"
          action="Deleting…"
        />
      </>
    );
  }
}
