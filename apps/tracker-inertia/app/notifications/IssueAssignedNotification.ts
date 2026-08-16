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

  toMail(_notifiable: Notifiable): MailMessage {
    return new MailMessage()
      .subject(`#${this.issue.id} assigned to you — ${this.issue.title}`)
      .line(`${this.assignedBy} assigned you an issue on ${this.projectSlug}.`)
      .line(this.issue.title)
      .action("Open the issue", `/projects/${this.projectSlug}/issues/${this.issue.id}`);
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
