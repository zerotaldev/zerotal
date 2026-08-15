import { env } from "zerotal";
import { AppConfig } from "zerotal/config";

export default AppConfig({
  name: "Zerotal Docs",
  url: env("APP_URL", "http://localhost:3000"),
  key: env("APP_KEY", "changeme-in-production"),

  // Same-origin unless `CORS_ORIGIN` names somewhere else. This site is read from
  // its own pages, so it needs nothing here — and `"*"` would let any website read
  // its responses out of a visitor's browser.
  cors: {
    origin: env("CORS_ORIGIN", ""),
    credentials: false,
  },

  // HSTS. Off by default framework-wide, so a deployed site has to ask for it.
  secureHeaders: {
    secure: env("APP_SECURE", true),
  },

  throttle: {
    maxAttempts: 120,
    windowSeconds: 60,
  },

  health: {
    enabled: true, // default: !production
    path: "/health", // default: '/health'
    secret: env("HEALTH_KEY", "my-health-key"), // required in production
    showDetails: true, // false → bare { "status": "ok" }
  },

  // `allowedOrigins` defaults to the origin of `url`, which is all this site needs:
  // behind the proxy the app's own origin is the loopback address it bound to, and the
  // public one has to be declared for the Flow socket and `/__flow/http` to accept a
  // browser's action frames. Name extra origins here only for a different host.
});
