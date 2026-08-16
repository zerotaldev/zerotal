import { Head, Link } from "@inertiajs/react";
import TrackerLayout from "../../Layouts/TrackerLayout";
import EmptyState from "../../Components/EmptyState";
import { ButtonLink } from "../../Components/Button";

interface ProjectRow {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  owner: { name: string } | null;
  issueCount: number;
}

export default function ProjectsIndex({ projects }: { title: string; projects: ProjectRow[] }) {
  return (
    <>
      <Head title="Projects" />

      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {projects.length} project{projects.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border bg-card">
          <EmptyState
            title="No projects yet"
            description="A project holds issues. Create one to start tracking work."
            action={<ButtonLink href="/projects/new">Create project</ButtonLink>}
          />
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.slug}`}
                className="block h-full rounded-xl border border-border bg-card p-5 transition-colors hover:border-muted-foreground/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <h2 className="text-sm font-semibold">{project.name}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {project.description ?? "No description."}
                </p>
                <dl className="mt-4 flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
                  <div>
                    <dt className="sr-only">Issues</dt>
                    <dd>
                      <span className="font-medium text-foreground">{project.issueCount}</span>{" "}
                      issue{project.issueCount === 1 ? "" : "s"}
                    </dd>
                  </div>
                  {project.owner && (
                    <div className="ml-auto">
                      <dt className="sr-only">Owner</dt>
                      <dd>{project.owner.name}</dd>
                    </div>
                  )}
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

ProjectsIndex.layout = (page: React.ReactNode) => <TrackerLayout>{page}</TrackerLayout>;
