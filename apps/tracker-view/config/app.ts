import { env, requireEnv } from "zerotal";
import { AppConfig } from "zerotal/config";

export default AppConfig({
  name: "Tracker",
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

  throttle: {
    maxAttempts: 120,
    windowSeconds: 60,
  },

  // This build has no client bundle at all — only a stylesheet. The generic
  // asset pipeline compiles it, which is the whole frontend toolchain here.
  assets: {
    entrypoint: "resources/css/app.css",
  },
});
