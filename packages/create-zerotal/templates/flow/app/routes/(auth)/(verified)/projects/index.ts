import type { HttpContext } from "zerotal";
import { Auth } from "zerotal/auth";
import { Project, type ProjectStatus } from "@app/models/Project";
import { ProjectRequest } from "@app/requests/ProjectRequest";

// POST /projects
//
// Anyone signed in may create a project (ProjectPolicy.create says the same); the route
// group already requires that, so there is nothing further to check here.
export async function POST(http: HttpContext): Promise<void> {
  const data = await ProjectRequest.validate();

  const project = new Project();
  project.fill({
    name: data.name,
    description: data.description || null,
    status: data.status as ProjectStatus,
  });
  // Set in code, never from the form: the owner is whoever is signed in.
  project.userId = Auth.user().id;
  await project.save();

  http.flash("success", `“${project.name}” was created.`);
  http.redirect("/projects", 303);
}
