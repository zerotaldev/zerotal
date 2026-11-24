import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Gate } from "zerotal/auth";
import type { Project } from "@app/models/Project";

// Named to match the other project routes; the generated name would be "projects.edit.show".
export const meta = { GET: { name: "projects.edit" } };

// GET /projects/:project/edit — `:project` arrives as the loaded model (a 404 if there
// is no such project), and the policy turns anyone but its owner away with a 403.
export const GET = async (http: HttpContext<{ project: Project }>) => {
  const project = http.params.project;
  Gate.authorize("update", project);

  return Inertia.render("projects/edit", {
    title: `Edit ${project.name}`,
    project: project.toPage(),
  });
};
