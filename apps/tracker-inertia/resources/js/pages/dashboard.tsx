import type { ReactNode } from "react";
import { Head, Link } from "@inertiajs/react";
import AppShell from "../Layouts/AppShell";
import PageHeader from "../Components/PageHeader";
import { Card } from "../Components/Card";
import { PriorityBadge, StatusBadge } from "../Components/Badge";

interface Props {
  title: string;
  stats: {
    total: number;
    unassigned: number;
    byStatus: { status: string; total: number }[];
    byPriority: { priority: string; total: number }[];
    projects: { name: string; slug: string; issueCount: number }[];
  };
}

/**
 * The numbers, and nothing else.
 *
 * No charts. A bar chart of five statuses says exactly what five labelled
 * numbers say, at the cost of a library and a set of colours that would compete
 * with the badges — which are the only place colour carries meaning here. The
 * breakdowns reuse the same badges the issue list uses, so a status looks the
 * same wherever it is read.
 */
function Dashboard({ title, stats }: Props) {
  return (
    <>
      <Head title={title} />

      <div className="space-y-6">
        <PageHeader title={__("Dashboard")} description={__("Everything tracked, counted.")} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label={__("Issues")} value={stats.total} />
          <Stat
            label={__("Unassigned issues")}
            value={stats.unassigned}
            hint={
              stats.total > 0
                ? `${Math.round((stats.unassigned / stats.total) * 100)}% of all issues`
                : undefined
            }
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-[0.9375rem] font-semibold">{__("By status")}</h2>
            <ul className="mt-4 space-y-2.5">
              {stats.byStatus.map(({ status, total }) => (
                <li key={status} className="flex items-center justify-between gap-3">
                  <StatusBadge status={status} />
                  <span className="text-sm font-medium tabular-nums">{total}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="text-[0.9375rem] font-semibold">{__("By priority")}</h2>
            <ul className="mt-4 space-y-2.5">
              {stats.byPriority.map(({ priority, total }) => (
                <li key={priority} className="flex items-center justify-between gap-3">
                  <PriorityBadge priority={priority} />
                  <span className="text-sm font-medium tabular-nums">{total}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card className="p-5">
          <h2 className="text-[0.9375rem] font-semibold">{__("Projects")}</h2>
          <ul className="mt-4 divide-y divide-border">
            {stats.projects.map((project) => (
              <li key={project.slug}>
                <Link
                  href={route("projects.show", { project: project.slug })}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-primary"
                >
                  <span className="truncate font-medium">{project.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {project.issueCount}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string | undefined }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

Dashboard.layout = (page: ReactNode) => <AppShell>{page}</AppShell>;

export default Dashboard;
