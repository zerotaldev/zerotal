import { Inertia } from "@zerotal/inertia";

// GET /projects/create
export const GET = async () => {
  return Inertia.render("projects/create", { title: "New project" });
};
