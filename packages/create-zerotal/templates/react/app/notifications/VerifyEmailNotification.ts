import { config } from "zerotal";
import { MailMessage, Notification } from "@zerotal/notifications";
import { signOff } from "../support/mail";

/**
 * The "confirm your email address" message, sent on registration and on request from
 * the notice page. The link carries a signed, single-use token that expires after an
 * hour (`User.emailVerificationExpireMinutes`); nothing about it is stored.
 */
export class VerifyEmailNotification extends Notification {
  constructor(private readonly token: string) {
    super();
  }

  channels(): string[] {
    return ["mail"];
  }

  /** The link the message carries. Public so a test can follow it. */
  url(): string {
    return `${config("app.url")}/verify-email/${this.token}`;
  }

  toMail(): MailMessage {
    return new MailMessage()
      .subject(`Confirm your email address for ${config("app.name")}`)
      .greeting("Almost there")
      .line("Confirm this is your email address to finish setting up your account.")
      .action("Confirm email address", this.url())
      .line("The link works once and expires in an hour. If you did not sign up, ignore this.")
      .salutation(signOff());
  }
}
