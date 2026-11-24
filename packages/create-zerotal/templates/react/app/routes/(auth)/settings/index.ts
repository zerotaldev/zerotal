import type { HttpContext } from "zerotal";

// GET /settings — the section opens on its first page.
export function GET(http: HttpContext): void {
  http.redirect("/profile", 302);
}
