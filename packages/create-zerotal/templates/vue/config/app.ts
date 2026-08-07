import { env, requireEnv } from "zerotal";
import { AppConfig } from "zerotal/config";

export default AppConfig({
  name: "{{name}}",
  url: env("APP_URL", "http://localhost:3000"),
  /**
   * The APP_KEY is used for encryption and should be set to a random 32
   * character string. Use `bun zt key:generate` to generate a secure key.
   */
  key: requireEnv("APP_KEY"),

  cors: {
    origin: env("CORS_ORIGIN", "*"),
    credentials: false,
  },

  throttle: {
    maxAttempts: 120,
    windowSeconds: 60,
  },

  // Frontend assets are built by the Inertia pipeline (`bun zt inertia:build`),
  // not the generic asset bundler — so no `assets` block is needed here.
});
