import { NotificationConfig } from "@zerotal/notifications";
import type { NotificationConfigShape } from "@zerotal/notifications";
import { env } from "zerotal";

/**
 * The log mail driver: a cookbook app should not need an SMTP account to be
 * runnable, and "did the mail go out" is answerable from the log and from the
 * database channel's row.
 */
export default NotificationConfig({
  mail: {
    driver: env("MAIL_DRIVER", "log") as NonNullable<NotificationConfigShape["mail"]>["driver"],
    from: { address: env("MAIL_FROM", "tracker@example.com"), name: "Tracker" },
  },
});
