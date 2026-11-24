import { env, requireEnv } from "zerotal";
import { AppConfig } from "zerotal/config";

export default AppConfig({
  // The one place the app's name lives. Page titles, the sidebar, outgoing mail and
  // the label authenticator apps show for two-factor codes all read it from here.
  // Rename the app by changing APP_NAME.
  name: env("APP_NAME", "{{name}}"),
  url: env("APP_URL", "http://localhost:3000"),
  /**
   * The APP_KEY is used for encryption and should be set to a random 32
   * character string. Use `bun zt key:generate` to generate a secure key.
   */
  key: requireEnv("APP_KEY"),

  // Same-origin unless CORS_ORIGIN names somewhere else. `"*"` would let any
  // website read this app's responses out of a visitor's browser.
  cors: {
    origin: env("CORS_ORIGIN", ""),
    credentials: false,
  },

  // HSTS, once you are serving over HTTPS.
  secureHeaders: {
    secure: env("APP_SECURE", false),
  },

  // GET /health — for load balancers, uptime monitors and the Dockerfile's HEALTHCHECK.
  // Set explicitly: `AppConfig()` leaves it off unless asked. In production it answers
  // only requests carrying HEALTH_KEY (as ?key= or an X-Health-Key header), and refuses
  // with a 503 until one is set, so it is never exposed by accident.
  health: {
    enabled: true,
    path: "/health",
    // Spread rather than assigned: `secret?: string` will not take the `undefined`
    // that `env()` returns when the variable is unset.
    ...(env("HEALTH_KEY", "") ? { secret: env("HEALTH_KEY", "") } : {}),
    showDetails: env("APP_ENV", "development") !== "production",
  },

  throttle: {
    maxAttempts: 120,
    windowSeconds: 60,
  },

  // The browser script: resources/js/app.js, bundled to public/js/app.js by `bun zt dev`
  // (on every change) and `bun zt assets:build` (for a release). The stylesheet is built
  // from resources/css/app.css to public/css/app.css alongside it.
  assets: {
    entrypoint: "resources/js/app.js",
    outDir: "public/js",
    prefix: env("ASSETS_PREFIX", "/"),
  },
});
