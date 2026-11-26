import { config } from "zerotal";

/**
 * The app's name, as config/app.ts sets it (APP_NAME). Read per call rather than once,
 * so renaming the app is one change on the server and nothing here.
 */
export function appName(): string {
  return String(config.safe("app.name", ""));
}

/** Where the header and footer "Docs" links point. */
export const DOCS_URL = "https://zerotal.dev/docs";
