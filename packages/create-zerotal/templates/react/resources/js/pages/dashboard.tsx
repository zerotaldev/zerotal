import type { ComponentType, ReactNode, SVGProps } from "react";
import { Head, Link } from "@inertiajs/react";
import AppLayout from "../Layouts/AppLayout";
import { ButtonLink } from "../Components/Button";
import { Card, CardHeader } from "../Components/Card";
import { EmptyState } from "../Components/EmptyState";
import { BoltIcon, CheckIcon, FolderIcon, PlusIcon } from "../Components/Icons";
import { PageHeader } from "../Components/PageHeader";
import { ProjectStatusBadge } from "../Components/ProjectStatusBadge";
import { timeAgo } from "../lib/format";
import type { Project } from "../types";

interface Props {
  title: string;
  greeting: string;
  stats: { total: number; active: number; completed: number };
  recentProjects: Project[];
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="size-5" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </div>
    </Card>
  );
}

function Dashboard({ title, greeting, stats, recentProjects }: Props) {
  return (
    <>
      <Head title={title} />

      <PageHeader
        title={greeting}
        description="Here is where your projects stand."
        actions={
          <ButtonLink href={route("projects.create")}>
            <PlusIcon className="size-4" />
            New project
          </ButtonLink>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Projects" value={stats.total} icon={FolderIcon} />
        <Stat label="Active" value={stats.active} icon={BoltIcon} />
        <Stat label="Completed" value={stats.completed} icon={CheckIcon} />
      </div>

      <div className="mt-8">
        {recentProjects.length === 0 ? (
          <EmptyState
            icon={FolderIcon}
            title="Start your first project"
            description="Projects are the example resource in this app: a list, a form, and a policy that keeps each one private to its owner. Make one to see it all work."
            action={
              <ButtonLink href={route("projects.create")}>
                <PlusIcon className="size-4" />
                Create a project
              </ButtonLink>
            }
          />
        ) : (
          <Card>
            <CardHeader
              title="Recently updated"
              actions={
                <Link
                  href={route("projects")}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  View all
                </Link>
              }
            />
            <ul className="mt-4 divide-y divide-border border-t border-border">
              {recentProjects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={route("projects.edit", { project: project.id })}
                    className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/50 sm:px-6"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                    <ProjectStatusBadge status={project.status} />
                    <span className="hidden w-28 shrink-0 text-right text-sm text-muted-foreground sm:block">
                      {timeAgo(project.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

Dashboard.layout = (page: ReactNode) => <AppLayout>{page}</AppLayout>;

export default Dashboard;
