/**
 * The deployment check `zt doctor` and `zt deploy` run against the mail config.
 *
 * `mail.driver` defaults to `"log"`, which is right in development and is the
 * quietest possible production failure: every message is written to a log file and
 * nothing anywhere reports a problem. No error, no bounce, no send — just password
 * resets that never arrive, found days later by someone asking why.
 *
 * @module
 */
import { deployEnv, isProdLike } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import type { DoctorCheck, DoctorCheckResult } from "@zerotal/core";
import { NotificationConfig } from "./config.ts";
import type { NotificationConfigShape } from "./types.ts";

/**
 * The from-address a project that never configured mail still has.
 *
 * It is what tells "this app does not send mail" apart from "this app sends mail
 * and its driver got knocked back to the default", which are the same setting and
 * very different problems. Anyone who set up mail changed this.
 */
const PLACEHOLDER_FROM = "hello@example.com";

/** The loaded notification config, or the defaults when the app declares none. */
function _mailConfig(app: Application): NotificationConfigShape["mail"] | undefined {
  try {
    const config = app.container.makeSync("config") as {
      get<T>(key: string, fallback: T): T;
    };
    return config.get<NotificationConfigShape>("notifications", NotificationConfig()).mail;
  } catch {
    return undefined;
  }
}

/**
 * Refuse a production release whose mail goes to a log file.
 *
 * Two tiers, because the same value means two things. An app with a real
 * from-address configured `log` by accident — or had it knocked back — and its mail
 * is silently going nowhere: that fails. An app still on the placeholder address
 * probably sends no mail at all, and failing its deploy over a setting it never
 * touched would be the framework inventing a problem: that warns.
 */
export const mailDriverCheck: DoctorCheck = {
  id: "mail-driver",
  label: "Mail driver",
  run(app: Application): DoctorCheckResult {
    const mail = _mailConfig(app);
    if (!mail) return { status: "ok", message: "no mail config to check" };

    if (mail.driver !== "log") {
      return { status: "ok", message: `${mail.driver}` };
    }

    if (!isProdLike(deployEnv())) {
      return { status: "ok", message: "log (fine outside production)" };
    }

    const configured = mail.from.address !== PLACEHOLDER_FROM;
    return {
      status: configured ? "fail" : "warn",
      message: configured
        ? `mail.driver is "log" in production, but mail.from.address is set to ` +
          `${mail.from.address} — every message this app sends is being written to a ` +
          `log file and delivered to nobody.`
        : `mail.driver is "log" in production. Nothing is delivered. ` +
          `(mail.from.address is still the default, so this app may not send mail at all.)`,
      fix: 'Set mail.driver to "smtp" or "resend" in config/notifications.ts, and its credentials with it.',
    };
  },
};
