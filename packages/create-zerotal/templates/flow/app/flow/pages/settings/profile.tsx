import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../components/Card";
import { TextField } from "../../components/Field";
import { SettingsLayout } from "../../layouts/SettingsLayout";
import { Page, titled } from "../../lib/page";

/** GET /settings/profile. The form PATCHes app/routes/(auth)/settings/profile.ts. */
export class ProfilePage extends Page {
  static override title = titled("Profile");

  override layout(page: HtmlNode): HtmlNode {
    return <SettingsLayout shell={this.shell()}>{page}</SettingsLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const user = this.user;

    return (
      <>
        {user && !user.hasVerifiedEmail() ? (
          <Alert
            tone="warning"
            title="Your email address is not confirmed yet"
            actions={
              <form method="post" action={route("verify-email.store")}>
                <Button type="submit" size="sm" variant="secondary" data-loading-text="Sending…">
                  Send the link again
                </Button>
              </form>
            }
          >
            Until it is, the dashboard and projects stay locked. Check your inbox for the link.
          </Alert>
        ) : null}

        <Card>
          {/* PATCH, which a browser form can't send alone: see resources/js/lib/forms.ts. */}
          <form method="post" action={route("settings.profile.update")} data-method="patch">
            <CardHeader title="Profile" description="Your name, and the address we email." />
            <CardBody class="space-y-5">
              <TextField
                label="Name"
                name="name"
                autocomplete="name"
                value={this.old("name", user?.name ?? "")}
                error={this.error("name")}
                required
              />
              <TextField
                label="Email"
                name="email"
                type="email"
                autocomplete="email"
                hint="Changing it sends a link to the new address to confirm it."
                value={this.old("email", user?.email ?? "")}
                error={this.error("email")}
                required
              />
            </CardBody>
            <CardFooter>
              <Button type="submit" data-loading-text="Saving…">
                Save
              </Button>
            </CardFooter>
          </form>
        </Card>
      </>
    );
  }
}
