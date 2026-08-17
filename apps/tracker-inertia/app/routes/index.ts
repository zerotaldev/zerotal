import { Inertia } from "@zerotal/inertia";

/**
 * GET / — the public page.
 *
 * No props. The copy used to be passed from here as `title` and `message`, which
 * meant two of the page's sentences were translated on the server while the rest
 * were translated in the browser — and the two only agreed because nothing had
 * yet changed language between them. The page owns its own copy now, and reads
 * every line from the same catalog.
 */
export const GET = async () => {
  return Inertia.render("home", {});
};
