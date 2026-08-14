import { env } from "zerotal";
import { AppConfig } from "zerotal/config";

export default AppConfig({
  name: "Zerotal Docs",
  url: env("APP_URL", "http://localhost:3000"),
  key: env("APP_KEY", "changeme-in-production"),

  cors: {
    origin: env("CORS_ORIGIN", "*"),
    credentials: false,
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
