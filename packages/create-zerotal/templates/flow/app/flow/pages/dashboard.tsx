import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { Project, type ProjectData } from "@app/models/Project";
import { Button } from "../components/Button";
import { Card, CardHeader } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { ProjectStatusBadge } from "../components/ProjectStatusBadge";
import { AppLayout } from "../layouts/AppLayout";
import { timeAgo } from "../lib/format";
import type { IconName } from "../lib/icons";
import { Page, titled } from "../lib/page";

/** "Good morning" before noon, and so on — by the server's clock. */
function timeOfDay(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function Stat({ label, value, icon }: { label: string; value: number; icon: IconName }): HtmlNode {
  return (
    <Card class="flex items-center gap-4 p-5">
      <div class="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
        <Icon name={icon} class="size-5" />
      </div>
      <div>
        <p class="text-sm text-muted-foreground">{label}</p>
        <p class="text-2xl font-semibold tabular-nums" data-stat={label.toLowerCase()}>
          {value}
        </p>
      </div>
    </Card>
  );
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

    return (
      <>
        <PageHeader
          title={`${timeOfDay(new Date().getHours())}, ${firstName}`}
          description="Here is where your projects stand."
          actions={
            <Button href={route("projects.create")}>
              <Icon name="plus" class="size-4" />
              New project
            </Button>
          }
        />

        <div class="grid gap-4 sm:grid-cols-3">
          <Stat label="Projects" value={this.stats.total} icon="folder" />
          <Stat label="Active" value={this.stats.active} icon="bolt" />
          <Stat label="Completed" value={this.stats.completed} icon="check" />
        </div>

        <div class="mt-8">
          {this.recentProjects.length === 0 ? (
            <EmptyState
              icon="folder"
              title="Start your first project"
              description="Projects are the example resource in this app: a list, a form, and a policy that keeps each one private to its owner. Make one to see it all work."
              action={
                <Button href={route("projects.create")}>
                  <Icon name="plus" class="size-4" />
                  Create a project
                </Button>
              }
            />
          ) : (
            <Card>
              <CardHeader
                title="Recently updated"
                actions={
                  <a
                    href={route("projects")}
                    class="text-sm font-medium text-primary hover:underline"
                  >
                    View all
                  </a>
                }
              />
              <ul class="mt-4 divide-y divide-border border-t border-border">
                {this.recentProjects.map((project) => (
                  <li>
                    <a
                      href={route("projects.edit", { project: project.id })}
                      class="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/50 sm:px-6"
                    >
                      <span class="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                      <ProjectStatusBadge status={project.status} />
                      <span class="hidden w-28 shrink-0 text-right text-sm text-muted-foreground sm:block">
                        {timeAgo(project.updatedAt)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </>
    );
  }
}
