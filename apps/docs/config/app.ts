import { env } from "zerotal";
import { AppConfig, type AppConfigShape } from "zerotal/config";

const url = env("APP_URL", "http://localhost:3000");

const base = AppConfig({
  name: "Zerotal Docs",
  url,
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
});

/**
 * Behind a reverse proxy the app's own origin is whatever loopback address it
 * was bound to, while the browser truthfully sends the public one.
 * `isAllowedOrigin()` guards the endpoints that bypass the middleware pipeline —
 * the Flow WebSocket and `/__flow/http` — by comparing the two, so without the
 * public origin declared here every button on the site is silently inert: the
 * socket never opens and the HTTP fallback answers 403 `Forbidden origin.`
 *
 * Derived from `APP_URL` rather than a second env var, since the public origin
 * is exactly what that already describes. Merged in after `AppConfig()` because
 * the runtime reads `allowedOrigins` but `AppConfigShape` does not declare it.
 */
const config: AppConfigShape & { allowedOrigins: string[] } = {
  ...base,
  allowedOrigins: [new URL(url).origin],
};

export default config;
