import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { validate } from "zerotal/validator";

// GET /contact — render the form. Errors and old input from a failed POST arrive
// on their own through Inertia's shared `errors` / `old` props; this route does
// not have to pass them.
export const GET = async () => {
  return Inertia.render("contact", {
    title: "Get in touch",
  });
};

// POST /contact — validate, then redirect. The redirect is the important part:
// answering a POST with a redirect is what keeps the browser's back button and a
// page refresh from re-submitting the form.
export async function POST(http: HttpContext): Promise<void> {
  // On failure this throws — the framework turns it into a 303 back to /contact
  // with the messages in `errors` and the submitted values in `old`. Nothing
  // below this line runs unless the input is valid, and `name` is a string.
  const { name } = await validate(http, (r) => ({
    name: r.string().trim().min(2).max(80),
    email: r.string().trim().email(),
    message: r.string().trim().min(10).max(2000),
  }));

  // Nothing is stored — this is where you would queue a job, send a notification
  // or write a row. Delete the flash and put your own work here.
  http.flash("success", `Thanks ${name}, your message came through.`);
  http.redirect("/contact", 303);
}
