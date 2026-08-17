import type { ReactNode } from "react";
import { Head } from "@inertiajs/react";
import AppShell from "../../Layouts/AppShell";
import PageHeader from "../../Components/PageHeader";
import EmptyState from "../../Components/EmptyState";
import ProjectCard, { type ProjectRow } from "../../Components/ProjectCard";
import { FolderIcon } from "../../Components/Icons";

export default function ProjectsIndex({ projects }: { title: string; projects: ProjectRow[] }) {
  return (
    <>
      <Head title={__("Projects")} />

      <div className="space-y-6">
        <PageHeader title={__("Projects")} description={__("Manage and track your projects.")} />

        {projects.length === 0 ? (
          <div className="rounded-xl border border-border bg-card">
            <EmptyState
              icon={<FolderIcon className="size-5" />}
              title={__("No projects yet")}
              description={__("Projects hold issues. Once one exists, it will show up here with everything tracked against it.")}
            />
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <li key={project.id}>
                <ProjectCard project={project} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

ProjectsIndex.layout = (page: ReactNode) => <AppShell>{page}</AppShell>;
