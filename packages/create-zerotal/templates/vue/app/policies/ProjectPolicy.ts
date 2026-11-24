import { Policy } from "zerotal/auth";
import type { Project } from "../models/Project.ts";
import type { User } from "../models/User.ts";

/**
 * Who may do what with a project: anyone signed in may create one, and only its owner
 * may see, change or delete it.
 *
 * Found by name — `ProjectPolicy` for `Project` — so `Gate.authorize("update", project)`
 * reaches it without being registered. A denial is a 403, rendered by the error page.
 */
export class ProjectPolicy extends Policy<Project> {
  view(user: User, project: Project): boolean {
    return project.userId === user.id;
  }

  create(_user: User): boolean {
    return true;
  }

  update(user: User, project: Project): boolean {
    return project.userId === user.id;
  }

  delete(user: User, project: Project): boolean {
    return project.userId === user.id;
  }
}
