import { env } from "zerotal";
import { SessionConfig } from "zerotal/session";

export default SessionConfig({
  driver: "cookie",
  // Cookie sessions are signed, so the driver needs the app key.
  secret: env("APP_KEY", ""),
  cookie: env("SESSION_COOKIE", "zerotal_session"),
  lifetime: 60 * 24 * 7,
});
