import { Router, view, type HttpContext } from "zerotal";
import Welcome from "../resources/js/pages/welcome";
import About from "../resources/js/pages/about";
import Contact from "../resources/js/pages/contact";

Router.get("/", () => view(Welcome, { title: "Welcome to Zerotal" }));
Router.get("/about", () => view(About, { title: "About" }));
Router.get("/contact", () => view(Contact, { title: "Contact" }));

Router.get("/api", (http: HttpContext) => {
  return http.json({ message: "Hello, API!" });
});

Router.get("/api/:id", (http: HttpContext) => {
  return http.json({ id: http.params.id, message: "Hello, API!" });
});
