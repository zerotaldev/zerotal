import { env } from "zerotal";
import { SessionConfig } from "zerotal/session";

// Cookie-driver sessions, signed with APP_KEY. This is what carries flash
// messages and a failed validation's errors and old input from one request to
// the next. Switch `driver` to "redis" for a shared, server-side store.
export default SessionConfig({
  secret: env("APP_KEY", ""),
  cookie: "tracker-inertia_session",
  lifetime: 60 * 60 * 24 * 7, // 7 days
});
