import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { listSessions, type SessionSummary } from "@app/auth/sessions";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card, CardFooter, CardHeader } from "../../components/Card";
import { Icon } from "../../components/Icon";
import { PasswordDialog } from "../../components/PasswordDialog";
import { SettingsLayout } from "../../layouts/SettingsLayout";
import { timeAgo } from "../../lib/format";
import { Page, titled } from "../../lib/page";

/**
 * GET /settings/sessions — every browser this account is signed in on. "Sign out other
 * sessions" DELETEs app/routes/(auth)/settings/sessions.ts, with the password.
 */
export class SessionsPage extends Page {
  static override title = titled("Sessions");

  sessions: SessionSummary[] = [];

  override async onMount(): Promise<void> {
    if (this.http && this.user) this.sessions = await listSessions(this.http, this.user.id);
  }

  override layout(page: HtmlNode): HtmlNode {
    return <SettingsLayout shell={this.shell()}>{page}</SettingsLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const others = this.sessions.filter((session) => !session.current).length;

    return (
      <>
        <Card>
          <CardHeader
            title="Where you're signed in"
            description="If you don't recognise a device, sign it out and change your password."
          />
          <ul class="mt-5 divide-y divide-border border-y border-border">
            {this.sessions.map((session) => (
              <li
                key={session.id}
                class="flex items-center gap-4 px-5 py-4 sm:px-6"
                data-session={session.current ? "current" : "other"}
              >
                <Icon
                  name={/iOS|Android/.test(session.platform) ? "phone" : "monitor"}
                  class="size-6 shrink-0 text-muted-foreground"
                />
                <div class="min-w-0 flex-1">
                  <p class="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {session.browser} on {session.platform}
                    {session.current ? <Badge tone="success">This device</Badge> : null}
                  </p>
                  <p class="text-sm text-muted-foreground">
                    {session.ipAddress ?? "Unknown address"} ·{" "}
                    {session.current
                      ? "Active now"
                      : `Last active ${timeAgo(session.lastActiveAt)}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <CardFooter class="rounded-t-none border-t-0">
            <Button variant="secondary" data-open-modal="sign-out-sessions" disabled={others === 0}>
              Sign out other sessions
            </Button>
          </CardFooter>
        </Card>

        <PasswordDialog
          id="sign-out-sessions"
          title="Sign out other sessions?"
          description="Every other browser and device will be signed out. Enter your password to confirm."
          method="delete"
          url={route("settings.sessions.destroy")}
          confirmLabel="Sign them out"
          action="Signing out…"
          variant="primary"
        />
      </>
    );
  }
}
