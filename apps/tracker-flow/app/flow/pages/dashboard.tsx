import { Component, Link, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { AuthMiddleware } from "zerotal/auth";
import { Cache } from "@zerotal/cache";
import { Issue, ISSUE_PRIORITIES, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { Project } from "@app/models/Project.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../layouts/app.tsx";
import {
  BADGE,
  CARD,
  GHOST,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
} from "../ui.ts";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

const TTL_SECONDS = 30;

/** The shape `stats` holds, named so the cache callback and the template agree. */
interface DashboardStats {
  total: number;
  unassigned: number;
  byStatus: { status: string; total: number }[];
  byPriority: { priority: string; total: number }[];
  projects: { name: string; slug: string; issueCount: number }[];
}

/**
 * GET /dashboard — feature 10, and the same aggregates the other two builds run.
 *
 * `GROUP BY` in the database, not a table loaded and counted; one cache key for
 * the whole set, so a refresh cannot show a breakdown that disagrees with the
 * total beside it.
 *
 * The one thing this build adds is the refresh button. The numbers are cached
 * for thirty seconds, which means the page can be *stale in a way the reader
 * cannot see* — the other two builds answer that with the browser's reload
 * button and a round trip. Here it is an action: `Cache.forget` then re-render,
 * over the socket already open, with the rail and the scroll position intact.
 * That is the whole difference between the three dashboards.
 */
export class DashboardPage extends Component {
  static layout = AppLayout;
  static title = "Dashboard";

  @expose async refreshStats(): Promise<void> {
    await Cache.forget("dashboard:stats");
    this.flash(__("Figures refreshed."));
  }

  async render(): Promise<HtmlNode> {
    const stats = await Cache.remember<DashboardStats>(
      "dashboard:stats",
      TTL_SECONDS,
      async () => {
        const byStatus = await Issue.query()
          .selectRaw("status, COUNT(*) as total")
          .groupBy("status")
          .get();
        const byPriority = await Issue.query()
          .selectRaw("priority, COUNT(*) as total")
          .groupBy("priority")
          .get();
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
          byPriority: ISSUE_PRIORITIES.map((priority) => ({
            priority,
            total: p[priority] ?? 0,
          })),
          projects: projects.map((project) => ({
            name: project.name,
            slug: project.slug,
            issueCount: Number(
              (project as unknown as { issuesCount?: number }).issuesCount ?? 0,
            ),
          })),
        };
      },
    );

    return (
      <div class="space-y-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold tracking-tight">{__("Dashboard")}</h1>
            <p class="mt-1 text-sm text-muted-foreground">{__("Everything tracked, counted.")}</p>
          </div>
          {/* `loadingAttr` disables the button while the action is in flight, so
              a slow cache rebuild cannot be queued five times by an impatient
              click. The runtime owns that state; there is no flag to reset. */}
          <button onClick={this.refreshStats} loadingAttr="disabled" class={GHOST}>
            {__("Refresh")}
          </button>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class={`${CARD} p-5`}>
            <p class="text-sm text-muted-foreground">{__("Issues")}</p>
            <p class="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
              {String(stats.total)}
            </p>
          </div>
          <div class={`${CARD} p-5`}>
            <p class="text-sm text-muted-foreground">{__("Unassigned issues")}</p>
            <p class="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
              {String(stats.unassigned)}
            </p>
          </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class={`${CARD} p-5`}>
            <h2 class="text-[0.9375rem] font-semibold">{__("By status")}</h2>
            <ul class="mt-4 space-y-2.5">
              {stats.byStatus.map(({ status, total }) => (
                <li key={status} class="flex items-center justify-between gap-3">
                  <span class={`${BADGE} ${STATUS_TONE[status] ?? ""}`}>
                    {__(STATUS_LABEL[status] ?? status)}
                  </span>
                  <span class="text-sm font-medium tabular-nums">{String(total)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div class={`${CARD} p-5`}>
            <h2 class="text-[0.9375rem] font-semibold">{__("By priority")}</h2>
            <ul class="mt-4 space-y-2.5">
              {stats.byPriority.map(({ priority, total }) => (
                <li key={priority} class="flex items-center justify-between gap-3">
                  <span class={`${BADGE} ${PRIORITY_TONE[priority] ?? ""}`}>
                    {__(PRIORITY_LABEL[priority] ?? priority)}
                  </span>
                  <span class="text-sm font-medium tabular-nums">{String(total)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div class={`${CARD} p-5`}>
          <h2 class="text-[0.9375rem] font-semibold">{__("Projects")}</h2>
          <ul class="mt-4 divide-y divide-border">
            {stats.projects.map((project) => (
              <li key={project.slug}>
                <Link
                  href={`/projects/${project.slug}`}
                  down
                  class="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-primary"
                >
                  <span class="truncate font-medium">{project.name}</span>
                  <span class="shrink-0 text-muted-foreground tabular-nums">
                    {String(project.issueCount)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
}
