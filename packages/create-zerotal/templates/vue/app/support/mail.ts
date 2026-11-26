import { config } from "zerotal";

/**
 * True while outgoing mail is printed rather than sent (MAIL_DRIVER=log, the default).
 * Pages that just "sent" an email say where to find it in that case — and only then.
 */
export function mailIsLogged(): boolean {
  return config.safe("notifications.mail.driver", "log") === "log";
}

/**
 * The line every message the app sends closes with: the app's name, as config/app.ts sets
 * it. Without one a message ends on the mailer's bare "Regards," and nobody under it.
 */
export function signOff(): string {
  return `The ${String(config("app.name"))} team`;
}
