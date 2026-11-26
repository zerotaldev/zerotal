import { config } from "zerotal";
import { MailMessage, Notification } from "@zerotal/notifications";
import { signOff } from "../support/mail";

/** The password-reset link, sent from the "Forgot your password?" page. */
export class ResetPasswordNotification extends Notification {
  constructor(
    private readonly token: string,
    private readonly email: string,
  ) {
    super();
  }

  channels(): string[] {
    return ["mail"];
  }

  /** The link the message carries. Public so a test can follow it. */
  url(): string {
    const query = new URLSearchParams({ token: this.token, email: this.email });
    return `${config("app.url")}/reset-password?${query}`;
  }

  toMail(): MailMessage {
    return new MailMessage()
      .subject(`Reset your ${config("app.name")} password`)
      .line("Someone asked to reset the password for this account.")
      .action("Choose a new password", this.url())
      .line("The link expires in an hour. If it was not you, ignore this — nothing changes.")
      .salutation(signOff());
  }
}
