import { config } from "zerotal";

/**
 * True while outgoing mail is printed rather than sent (MAIL_DRIVER=log, the default).
 * Pages that just "sent" an email say where to find it in that case — and only then.
 */
export function mailIsLogged(): boolean {
  return config.safe("notifications.mail.driver", "log") === "log";
}
