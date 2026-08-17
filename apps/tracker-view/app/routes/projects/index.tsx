import { view } from "zerotal";
import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware } from "zerotal/auth";
import { Project } from "@app/models/Project.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../../resources/views/layouts/AppLayout.tsx";
import { Card, EmptyState, PageHeader } from "../../../resources/views/components/Ui.tsx";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/** GET /projects — the same query the Inertia build runs, rendered on the server. */
export const GET = async (http: HttpContext) => {

  // `withCount` rather than loading each project's issues — one query, not one
  // per project. Identical to the other build, because it is the same seam.
  const projects = await Project.query().with("owner").withCount("issues").orderBy("name").get();
  const user = Auth.userOrNull();

  view(
    <AppLayout
      title={__("Projects")}
      active="projects"
      user={user ? { name: user.name, email: user.email } : null}
      flash={{
        success: http.session?.get<string>("success") ?? null,
        error: http.session?.get<string>("error") ?? null,
      }}
    >
      <div class="space-y-6">
        <PageHeader title={__("Projects")} description={__("Manage and track your projects.")} />

        {projects.length === 0 ? (
          <Card>
            <EmptyState title={__("No projects yet")} description={__("Projects hold issues. Once one exists, it will show up here with everything tracked against it.")} />
          </Card>
        ) : (
          <ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => {
              const count = Number(
                (project as unknown as { issuesCount?: number }).issuesCount ?? 0,
              );
              return (
                <li>
                  <a
                    href={`/projects/${project.slug}`}
                    class="flex h-full flex-col rounded-xl border border-border bg-card p-5 transition-[border-color,box-shadow] hover:border-muted-foreground/30 hover:shadow-sm"
                  >
                    <h2 class="truncate text-[0.9375rem] font-semibold text-card-foreground">
                      {project.name}
                    </h2>
                    <p class="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {project.description ?? "—"}
                    </p>
                    <p class="mt-4 text-sm tabular-nums">
                      <span class="font-medium text-foreground">{String(count)}</span>{" "}
                      <span class="text-muted-foreground">{__("Issues")}</span>
                    </p>
                    {project.owner ? (
                      <div class="mt-auto border-t border-border pt-4">
                        <span class="truncate text-xs text-muted-foreground">
                          {project.owner.name}
                        </span>
                      </div>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppLayout>,
  );
};
