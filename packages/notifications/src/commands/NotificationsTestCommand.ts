import type { Application, ArgDef } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { NotificationManager } from "../NotificationManager.ts";
import { Notification } from "../Notification.ts";
import { MailMessage } from "../messages/MailMessage.ts";
import type { Notifiable } from "../types.ts";

/** The message `notifications:test` sends. Nothing else references it. */
class TestNotification extends Notification {
  channels(): string[] {
    return ["mail"];
  }

  toMail(_notifiable: Notifiable): MailMessage {
    return new MailMessage()
      .subject("Zerotal test notification")
      .greeting("Hello,")
      .line("If you are reading this, your mail configuration works.")
      .line(`Sent at ${new Date().toISOString()}.`)
      .salutation("— Zerotal");
  }
}

/**
 * `zt notifications:test <email>` — send one real email through the configured
 * mail driver.
 *
 * Mail configuration fails in ways unit tests cannot reach: a wrong port, a
 * refused STARTTLS upgrade, credentials the server rejects. This exercises the
 * whole path and prints what the server said.
 *
 * @internal
 */
export class NotificationsTestCommand extends Command {
  static commandName = "notifications:test";
  static description = "Send a test email through the configured mail driver";
  static needsApp = true;

  static args: ArgDef[] = [{ name: "email", required: true }];

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    if (!app) {
      this.error("Application not available.");
      return;
    }

    const email = this.args["email"];
    if (!email || !email.includes("@")) {
      this.error(`'${String(email)}' is not an email address.`);
      return;
    }

    const notifications = app.container.makeSync("notifications") as NotificationManager;

    this.line(`Sending a test notification to ${email}…`);
    try {
      await notifications.route({ mail: email }).notify(new TestNotification());
      this.info(`Sent. Check ${email} (and the mail driver's own log).`);
    } catch (error) {
      // The provider's own message is the useful part — surface it verbatim.
      this.error(`Send failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
