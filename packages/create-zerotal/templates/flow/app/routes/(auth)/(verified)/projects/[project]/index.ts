import type { HttpContext } from "zerotal";
import { Gate } from "zerotal/auth";
import type { Project } from "@app/models/Project";
import { ProjectRequest } from "@app/requests/ProjectRequest";

// PUT /projects/:project
export async function PUT(http: HttpContext<{ project: Project }>): Promise<void> {
  const project = http.params.project;
  Gate.authorize("update", project);
  const data = await ProjectRequest.validate();

  project.fill({
    name: data.name,
    description: data.description || null,
    status: data.status,
  });
  await project.save();

  http.flash("success", `“${project.name}” was saved.`);
  http.redirect("/projects", 303);
}

// DELETE /projects/:project
export async function DELETE(http: HttpContext<{ project: Project }>): Promise<void> {
  const project = http.params.project;
  Gate.authorize("delete", project);

  await project.delete();

  http.flash("success", `“${project.name}” was deleted.`);
  http.redirect("/projects", 303);
}
