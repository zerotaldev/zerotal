import type { HttpContext } from "zerotal";
import { Auth } from "zerotal/auth";
import { forgetSession } from "@app/auth/sessions";

// POST /logout. POST rather than GET: a link that signs you out can be triggered by any
// page that manages to make your browser fetch it.
export async function POST(http: HttpContext): Promise<void> {
  await forgetSession(http);
  await Auth.logout();
  http.flash("success", "You have been signed out.");
  http.redirect("/login", 303);
}
