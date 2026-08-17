import { view } from "zerotal";
import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware } from "zerotal/auth";
import { Cache } from "@zerotal/cache";
import { Issue, ISSUE_PRIORITIES, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { Project } from "@app/models/Project.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../resources/views/layouts/AppLayout.tsx";
import {
  Card,
  PageHeader,
  PRIORITY_LABEL,
  PriorityBadge,
  STATUS_LABEL,
  StatusBadge,
} from "../../resources/views/components/Ui.tsx";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

const TTL_SECONDS = 30;

/**
 * GET /dashboard — feature 10, and the same aggregates the Inertia build runs.
 *
 * `GROUP BY` in the database, not a table loaded and counted; one cache key for
 * the whole set, so a refresh cannot show a breakdown that disagrees with the
 * total beside it. Identical to the other build because it is the same seam —
 * only the rendering differs.
 */
export const GET = async (http: HttpContext) => {

  const stats = await Cache.remember("dashboard:stats", TTL_SECONDS, async () => {
    const byStatus = await Issue.query().selectRaw("status, COUNT(*) as total").groupBy("status").get();
    const byPriority = await Issue.query().selectRaw("priority, COUNT(*) as total").groupBy("priority").get();
    const projects = await Project.query().withCount("issues").orderBy("name").get();
    const total = await Issue.query().count();
    const unassigned = await Issue.query().whereNull("assignee_id").count();

    const tally = (rows: unknown[], key: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        out[String(r[key])] = Number(r["total"] ?? 0);
      }
      return out;
    };
    const s = tally(byStatus, "status");
    const p = tally(byPriority, "priority");

    return {
      total,
      unassigned,
      byStatus: ISSUE_STATUSES.map((status) => ({ status, total: s[status] ?? 0 })),
      byPriority: ISSUE_PRIORITIES.map((priority) => ({ priority, total: p[priority] ?? 0 })),
      projects: projects.map((project) => ({
        name: project.name,
        slug: project.slug,
        issueCount: Number((project as unknown as { issuesCount?: number }).issuesCount ?? 0),
      })),
    };
  });

  const user = Auth.userOrNull();

  view(
    <AppLayout
      title={__("Dashboard")}
      active="dashboard"
      user={user ? { name: user.name, email: user.email } : null}
      flash={{ success: http.session?.get<string>("success") ?? null }}
    >
      <div class="space-y-6">
        <PageHeader title={__("Dashboard")} description={__("Everything tracked, counted.")} />

        <div class="grid gap-4 sm:grid-cols-2">
          <Card class="p-5">
            <p class="text-sm text-muted-foreground">{__("Issues")}</p>
            <p class="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{String(stats.total)}</p>
          </Card>
          <Card class="p-5">
            <p class="text-sm text-muted-foreground">{__("Unassigned issues")}</p>
            <p class="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{String(stats.unassigned)}</p>
          </Card>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <Card class="p-5">
            <h2 class="text-[0.9375rem] font-semibold">{__("By status")}</h2>
            <ul class="mt-4 space-y-2.5">
              {stats.byStatus.map(({ status, total }) => (
                <li class="flex items-center justify-between gap-3">
                  <StatusBadge status={status} label={__(STATUS_LABEL[status] ?? status)} />
                  <span class="text-sm font-medium tabular-nums">{String(total)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card class="p-5">
            <h2 class="text-[0.9375rem] font-semibold">{__("By priority")}</h2>
            <ul class="mt-4 space-y-2.5">
              {stats.byPriority.map(({ priority, total }) => (
                <li class="flex items-center justify-between gap-3">
                  <PriorityBadge priority={priority} label={__(PRIORITY_LABEL[priority] ?? priority)} />
                  <span class="text-sm font-medium tabular-nums">{String(total)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card class="p-5">
          <h2 class="text-[0.9375rem] font-semibold">{__("Projects")}</h2>
          <ul class="mt-4 divide-y divide-border">
            {stats.projects.map((project) => (
              <li>
                <a href={route("projects.show", { project: project.slug })} class="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-primary">
                  <span class="truncate font-medium">{project.name}</span>
                  <span class="shrink-0 text-muted-foreground tabular-nums">{String(project.issueCount)}</span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppLayout>,
  );
};
