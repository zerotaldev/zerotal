import { Router, type HttpContext } from "zerotal";

// This app is the admin panel, and the panel lives at /admin. Without this the bare
// origin the dev server prints answers with a JSON 404, and nothing says where to go.
Router.get("/", (http: HttpContext) => {
  http.redirect("/admin");
});
