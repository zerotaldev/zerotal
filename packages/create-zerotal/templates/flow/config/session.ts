import { env } from "zerotal";
import { SessionConfig } from "zerotal/session";

export default SessionConfig({
  driver: "cookie",
  // Cookie sessions are signed, so the driver needs the app key.
  secret: env("APP_KEY", ""),
  cookie: "{{name}}_session",
  // Seven days suits a demo. Anything holding a credential wants less — an app
  // whose session carries a live mailbox password runs ten hours.
  lifetime: 60 * 60 * 24 * 7, // 7 days
  // Tied to the scheme rather than hardcoded: a `secure` cookie is never sent
  // over plain HTTP, so setting it unconditionally would drop the session in
  // local development. The framework refuses to boot production without it.
  secure: env("APP_URL", "http://localhost:3000").startsWith("https://"),
});
