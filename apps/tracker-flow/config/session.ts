import { env } from "zerotal";
import { SessionConfig } from "zerotal/session";

// Cookie-driver sessions, signed with APP_KEY. This is what carries flash
// messages and a failed validation's errors and old input from one request to
// the next. Switch `driver` to "redis" for a shared, server-side store.
export default SessionConfig({
  secret: env("APP_KEY", ""),
  // Named for *this* app, not the one it was scaffolded from.
  //
  // A cookie's origin ignores the port, so every app served on localhost shares
  // one jar. All three cookbook builds shipped with "tracker-inertia_session",
  // which meant running two of them side by side — the normal way to compare
  // them — had each one's sign-in silently overwrite the other's.
  cookie: "tracker-flow_session",
  lifetime: 60 * 60 * 24 * 7, // 7 days
});
