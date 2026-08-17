import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware } from "zerotal/auth";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

// POST rather than GET: a link that signs you out can be triggered by any page
// that manages to make your browser fetch it. Not a Flow page — it renders
// nothing, it ends a session and redirects.
export async function POST(http: HttpContext): Promise<void> {
  await Auth.logout();
  http.flash("success", __("Signed out."));
  http.redirect("/login", 303);
}
