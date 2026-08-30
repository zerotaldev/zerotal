import { env } from "zerotal";
import { SessionConfig } from "zerotal/session";

export default SessionConfig({
  driver: "cookie",
  // Cookie sessions are signed, so the driver needs the app key.
  secret: env("APP_KEY", ""),
  cookie: env("SESSION_COOKIE", "zerotal_session"),
  lifetime: 60 * 24 * 7,
  // `secure` gates the cookie on HTTPS, and the two environments need opposite
  // answers. Production refuses to boot without it — the config validator is right
  // to — but development runs on http://localhost, where a secure cookie is never
  // sent at all, and the symptom there is a login that appears to succeed and then
  // bounces back to the sign-in page with nothing in any log.
  //
  // Scaffolded environment-aware because every app ends up writing this line, and
  // the ones that write it after their first failed production deploy write it at
  // the worst possible moment.
  secure: env("APP_ENV", "development") === "production",
  httpOnly: true,

  // `Lax`, not `Strict`. Invitation and password-reset links arrive from a mail
  // client, and `Strict` withholds the cookie on exactly that first cross-site
  // navigation — so the link lands the user on a sign-in page instead.
  sameSite: "Lax",
});
