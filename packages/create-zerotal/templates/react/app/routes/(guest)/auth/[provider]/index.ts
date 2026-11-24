import type { HttpContext } from "zerotal";
import { Social } from "zerotal/auth";
import { enabledProvider } from "@app/auth/social";

// Route names, as `route()` knows them. Set here so they read the same across verbs.
export const meta = { GET: { name: "social.redirect" } };

// GET /auth/:provider — off to GitHub or Google to approve the sign-in. The driver
// stores a one-time `state` in the session and redirects; the callback checks it.
export async function GET(http: HttpContext): Promise<void> {
  await Social.driver(enabledProvider(http)).redirect();
}
