import { Notification, MailMessage } from "@zerotal/notifications";
import type { Notifiable } from "@zerotal/notifications";
import type { Issue } from "@app/models/Issue.ts";

/**
 * Someone has been given an issue.
 *
 * Two channels on purpose. `mail` is the side effect that has to survive leaving
 * the request — it is queued, so it runs in a worker with no HTTP context, no
 * session and no authenticated user. `database` is the inbox the app can render,
 * and it is what lets a test assert the notification arrived without reading a
 * mail log.
 *
 * Feature 6 exists to put a job in that scope-less context deliberately: the
 * Flow trace bug was a context that never became a trace, and a queue job is its
 * untested twin.
 */
export class IssueAssignedNotification extends Notification {
  constructor(
    private readonly issue: Issue,
    private readonly projectSlug: string,
    private readonly assignedBy: string,
  ) {
    super();
  }

  channels(): string[] {
    return ["mail", "database"];
  }

  /**
   * Rendered in the **recipient's** language, not the sender's — feature 12,
   * and the seam the whole feature exists to test.
   *
   * This method runs in a queue worker: no request, no session, no
   * `I18nContext` established by any middleware. Whatever locale the person who
   * *triggered* this was reading in is gone by the time it executes, and it was
   * never the right answer anyway — mail should arrive in the language of the
   * person opening it.
   *
   * So the locale is read off the notifiable and passed to `t()` explicitly.
   * That third argument is the whole mechanism, and it is why `t()` accepting
   * one matters: without it a job would have to reach for an ambient context
   * that a job does not have.
   */
  toMail(notifiable: Notifiable): MailMessage {
    const recipient = notifiable as { name?: string; locale?: string | null };
    const locale = recipient.locale ?? undefined;
    // Every line is written out in English at the call site. The old helper
    // assembled `notification.assigned.${key}`, which meant the actual sentences
    // lived in a file this one never named — and a grep for the subject line a
    // user reported found nothing.
    const line = (text: string, replacements: Record<string, string> = {}) =>
      __(text, replacements, locale);

    // `greeting()` and `salutation()`, not two more `line()` calls. MailMessage
    // renders its own "Hello," and "Regards," when those are left unset, so a
    // notification that supplies only the body produces English chrome wrapped
    // around a translated message. The template was never the problem.
    return new MailMessage()
      .subject(line("{actor} assigned you an issue", { actor: this.assignedBy }))
      .greeting(line("Hello {name},", { name: recipient.name ?? "" }))
      .line(
        line('{actor} assigned "{title}" to you.', {
          actor: this.assignedBy,
          title: this.issue.title,
        }),
      )
      .action(line("View the issue"), `/projects/${this.projectSlug}/issues/${this.issue.id}`)
      .salutation(line("Regards,"));
  }

  toDatabase(_notifiable: Notifiable): Record<string, unknown> {
    return {
      issueId: this.issue.id,
      title: this.issue.title,
      projectSlug: this.projectSlug,
      assignedBy: this.assignedBy,
    };
  }
}
