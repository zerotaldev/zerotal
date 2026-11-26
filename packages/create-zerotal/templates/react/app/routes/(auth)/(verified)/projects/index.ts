import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Auth } from "zerotal/auth";
import { Project } from "@app/models/Project";
import { ProjectRequest } from "@app/requests/ProjectRequest";

const PER_PAGE = 10;

// GET /projects?search=…&page=… — the signed-in user's projects, newest first.
export const GET = async (http: HttpContext) => {
  const url = new URL(http.request.url);
  const search = (url.searchParams.get("search") ?? "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  let query = Project.query().where("user_id", Auth.user().id);
  if (search) {
    // Name or description, case-insensitively — LIKE is, on SQLite, for ASCII.
    query = query.where((q) =>
      q.whereLike("name", `%${search}%`).orWhereLike("description", `%${search}%`),
    );
  }
  const result = await query
    .orderBy("updated_at", "desc")
    .orderBy("id", "desc")
    .paginate(PER_PAGE, page);

  return Inertia.render("projects/index", {
    title: "Projects",
    projects: result.data.map((project) => project.toPage()),
    pagination: {
      page: result.page,
      lastPage: result.lastPage,
      total: result.total,
      from: result.from,
      to: result.to,
    },
    search,
  });
};

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
    status: data.status,
  });
  // Set in code, never from the form: the owner is whoever is signed in.
  project.userId = Auth.user().id;
  await project.save();

  http.flash("success", `“${project.name}” was created.`);
  http.redirect("/projects", 303);
}
