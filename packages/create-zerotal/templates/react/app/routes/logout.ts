import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware } from "zerotal/auth";

export const middleware = [AuthMiddleware];

// POST rather than GET: a link that signs you out can be triggered by any page
// that manages to make your browser fetch it.
export async function POST(http: HttpContext): Promise<void> {
  await Auth.logout();
  http.flash("success", "Signed out.");
  http.redirect("/login", 303);
}
