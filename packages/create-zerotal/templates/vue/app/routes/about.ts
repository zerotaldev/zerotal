import { Inertia } from "@zerotal/inertia";

// GET /about — the URL comes from this file's path under app/routes.
export const GET = async () => {
  return Inertia.render("about", {
    title: "How this app fits together",
  });
};
