import { env } from "zerotal";
import { NotificationConfig } from "@zerotal/notifications";
import app from "./app";

export default NotificationConfig({
  mail: {
    // "log" writes every message — verification and password-reset links included —
    // to the server's output instead of sending it, so a new app works before it has
    // a mail server. Set MAIL_DRIVER to "smtp" or "resend" (and their keys) to send.
    driver: env("MAIL_DRIVER", "log") as "log" | "smtp" | "resend",
    from: {
      address: env("MAIL_FROM_ADDRESS", "hello@example.com"),
      name: env("MAIL_FROM_NAME", app.name),
    },
    smtp: {
      host: env("SMTP_HOST", "localhost"),
      port: Number(env("SMTP_PORT", "1025")),
      secure: env("SMTP_SECURE", "false") === "true",
      username: env("SMTP_USERNAME", ""),
      password: env("SMTP_PASSWORD", ""),
    },
    resend: { apiKey: env("RESEND_API_KEY", "") },
  },
});
