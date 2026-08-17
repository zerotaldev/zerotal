import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware } from "zerotal/auth";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";

// `UserLocaleMiddleware` matters on the way *out*: the farewell is the last
// thing this account reads, and without it "Signed out." resolves against the
// request's locale rather than the one on their row. It was the only
// authenticated route missing it.
export const middleware = [AuthMiddleware, UserLocaleMiddleware];

// POST rather than GET: a link that signs you out can be triggered by any page
// that manages to make your browser fetch it.
export async function POST(http: HttpContext): Promise<void> {
  await Auth.logout();
  http.flash("success", __("Signed out."));
  http.redirect("/login", 303);
}
