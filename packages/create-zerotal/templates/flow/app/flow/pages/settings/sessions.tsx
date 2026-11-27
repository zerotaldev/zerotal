import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { listSessions, type SessionSummary } from "@app/auth/sessions";
import { SettingsLayout } from "../../layouts/SettingsLayout";
import { buttonClass } from "../../lib/button";
import { timeAgo } from "../../lib/format";
import { Page, titled } from "../../lib/page";
import {
  CARD,
  CARD_DESCRIPTION,
  CARD_FOOTER,
  CARD_HEADER,
  CARD_TITLE,
  DIALOG_BUTTONS,
  FIELD,
  FIELD_ERROR,
  FIELD_LABEL_ROW,
  INPUT,
  LABEL,
  MODAL,
  MODAL_CLOSE,
  badgeClass,
  icon,
} from "../../lib/ui";

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
    const sessions = this.sessions;
    const others = sessions.filter((session) => !session.current).length;

    return (
      <>
        <div class={CARD}>
          <div class={CARD_HEADER}>
            <div class="min-w-0">
              <h2 class={CARD_TITLE}>Where you're signed in</h2>
              <p class={CARD_DESCRIPTION}>
                If you don't recognise a device, sign it out and change your password.
              </p>
            </div>
          </div>
          <ul aria-label="Sessions" class="mt-5 divide-y divide-border border-y border-border">
            {sessions.map((session) => (
              <li key={session.id} class="flex items-center gap-4 px-5 py-4 sm:px-6">
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  class="size-6 shrink-0 text-muted-foreground"
                  dangerouslySetInnerHTML={icon(
                    /iOS|Android/.test(session.platform) ? "phone" : "monitor",
                  )}
                />
                <div class="min-w-0 flex-1">
                  <p class="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {session.browser} on {session.platform}
                    {session.current ? (
                      <span class={badgeClass("success")}>This device</span>
                    ) : null}
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
          <div class={`${CARD_FOOTER} rounded-t-none border-t-0`}>
            <button
              type="button"
              class={buttonClass("secondary", "md")}
              data-open-modal="sign-out-sessions"
              disabled={others === 0}
            >
              Sign out other sessions
            </button>
          </div>
        </div>

        <dialog
          id="sign-out-sessions"
          data-modal=""
          aria-labelledby="sign-out-sessions-title"
          aria-describedby="sign-out-sessions-description"
          class={MODAL}
        >
          <div class="p-5 sm:p-6">
            <div class="flex items-start justify-between gap-4">
              <h2 id="sign-out-sessions-title" class="text-lg font-semibold">
                Sign out other sessions?
              </h2>
              <button type="button" data-close-modal="" aria-label="Close" class={MODAL_CLOSE}>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  class="size-4.5"
                  dangerouslySetInnerHTML={icon("close")}
                />
              </button>
            </div>
            <p id="sign-out-sessions-description" class="mt-1.5 text-sm text-muted-foreground">
              Every other browser and device will be signed out. Enter your password to confirm.
            </p>
            <div class="mt-5">
              <form
                method="post"
                action={route("settings.sessions.destroy")}
                data-method="delete"
                class="space-y-5"
              >
                <div class={FIELD}>
                  <div class={FIELD_LABEL_ROW}>
                    <label for="sign-out-sessions-password" class={LABEL}>
                      Password
                    </label>
                  </div>
                  <input
                    class={INPUT}
                    type="password"
                    autocomplete="current-password"
                    autofocus
                    required
                    id="sign-out-sessions-password"
                    name="password"
                  />
                  <p
                    id="sign-out-sessions-password-error"
                    data-error-for="password"
                    class={FIELD_ERROR}
                    hidden
                  ></p>
                </div>
                <div class={DIALOG_BUTTONS}>
                  <button type="button" class={buttonClass("secondary", "md")} data-close-modal="">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    class={buttonClass("primary", "md")}
                    data-loading-text="Signing out…"
                  >
                    Sign them out
                  </button>
                </div>
              </form>
            </div>
          </div>
        </dialog>
      </>
    );
  }
}
