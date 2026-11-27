import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { Project, type ProjectData } from "@app/models/Project";
import { PROJECT_STATUS } from "../components/ProjectStatusBadge";
import { AppLayout } from "../layouts/AppLayout";
import { buttonClass } from "../lib/button";
import { timeAgo } from "../lib/format";
import type { IconName } from "../lib/icons";
import { Page, titled } from "../lib/page";
import {
  CARD,
  CARD_ACTIONS,
  CARD_HEADER,
  CARD_TITLE,
  EMPTY_DESCRIPTION,
  EMPTY_ICON,
  EMPTY_STATE,
  EMPTY_TITLE,
  PAGE_ACTIONS,
  PAGE_DESCRIPTION,
  PAGE_HEADER,
  PAGE_HEADER_ROW,
  PAGE_TITLE,
  badgeClass,
  icon,
} from "../lib/ui";

/** "Good morning" before noon, and so on — by the server's clock. */
function timeOfDay(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** GET /dashboard — where a user lands after signing in. */
export class DashboardPage extends Page {
  static override title = titled("Dashboard");

  stats = { total: 0, active: 0, completed: 0 };
  recentProjects: ProjectData[] = [];

  override async onMount(): Promise<void> {
    if (!this.user) return;
    const mine = () => Project.query().where("user_id", this.user!.id);

    const [total, active, completed, recent] = await Promise.all([
      mine().count(),
      mine().where("status", "active").count(),
      mine().where("status", "completed").count(),
      mine().orderBy("updated_at", "desc").orderBy("id", "desc").limit(5).get(),
    ]);

    this.stats = { total: Number(total), active: Number(active), completed: Number(completed) };
    this.recentProjects = recent.map((project) => project.toPage());
  }

  override layout(page: HtmlNode): HtmlNode {
    return <AppLayout shell={this.shell()}>{page}</AppLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const name = this.user?.name ?? "";
    const firstName = name.split(" ")[0] ?? name;
    const greeting = `${timeOfDay(new Date().getHours())}, ${firstName}`;
    const stats: { label: string; value: number; icon: IconName }[] = [
      { label: "Projects", value: this.stats.total, icon: "folder" },
      { label: "Active", value: this.stats.active, icon: "bolt" },
      { label: "Completed", value: this.stats.completed, icon: "check" },
    ];
    const recent = this.recentProjects;

    return (
      <>
        <header class={PAGE_HEADER}>
          <div class={PAGE_HEADER_ROW}>
            <div class="min-w-0">
              <h1 class={PAGE_TITLE}>{greeting}</h1>
              <p class={PAGE_DESCRIPTION}>Here is where your projects stand.</p>
            </div>
            <div class={PAGE_ACTIONS}>
              <a href={route("projects.create")} class={buttonClass()}>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  class="size-4"
                  dangerouslySetInnerHTML={icon("plus")}
                />
                New project
              </a>
            </div>
          </div>
        </header>

        <div class="grid gap-4 sm:grid-cols-3">
          {stats.map((stat) => (
            <div role="group" aria-label={stat.label} class={`${CARD} flex items-center gap-4 p-5`}>
              <div class="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  class="size-5"
                  dangerouslySetInnerHTML={icon(stat.icon)}
                />
              </div>
              <div>
                <p class="text-sm text-muted-foreground">{stat.label}</p>
                <p class="text-2xl font-semibold tabular-nums">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>

        <div class="mt-8">
          {recent.length === 0 ? (
            <div class={EMPTY_STATE}>
              <div class={EMPTY_ICON}>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  class="size-6"
                  dangerouslySetInnerHTML={icon("folder")}
                />
              </div>
              <h3 class={EMPTY_TITLE}>Start your first project</h3>
              <p class={EMPTY_DESCRIPTION}>
                Projects are the example resource in this app: a list, a form, and a policy that
                keeps each one private to its owner. Make one to see it all work.
              </p>
              <div class="mt-6">
                <a href={route("projects.create")} class={buttonClass()}>
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    class="size-4"
                    dangerouslySetInnerHTML={icon("plus")}
                  />
                  Create a project
                </a>
              </div>
            </div>
          ) : (
            <div class={CARD}>
              <div class={CARD_HEADER}>
                <div class="min-w-0">
                  <h2 class={CARD_TITLE}>Recently updated</h2>
                </div>
                <div class={CARD_ACTIONS}>
                  <a
                    href={route("projects")}
                    class="text-sm font-medium text-primary hover:underline"
                  >
                    View all
                  </a>
                </div>
              </div>
              <ul class="mt-4 divide-y divide-border border-t border-border">
                {recent.map((project) => {
                  const status = PROJECT_STATUS[project.status];
                  const updated = timeAgo(project.updatedAt);
                  return (
                    <li>
                      <a
                        href={route("projects.edit", { project: project.id })}
                        class="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/50 sm:px-6"
                      >
                        <span class="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                        <span class={badgeClass(status.tone)}>{status.label}</span>
                        <span class="hidden w-28 shrink-0 text-right text-sm text-muted-foreground sm:block">
                          {updated}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </>
    );
  }
}
