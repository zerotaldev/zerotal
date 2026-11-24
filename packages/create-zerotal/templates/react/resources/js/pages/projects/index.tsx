import { useEffect, useRef, useState, type ReactNode } from "react";
import { Head, Link, router } from "@inertiajs/react";
import AppLayout from "../../Layouts/AppLayout";
import { Button, ButtonLink } from "../../Components/Button";
import { Card } from "../../Components/Card";
import { EmptyState } from "../../Components/EmptyState";
import { FolderIcon, PencilIcon, PlusIcon, SearchIcon, TrashIcon } from "../../Components/Icon";
import { Input } from "../../Components/Input";
import { Modal } from "../../Components/Modal";
import { PageHeader } from "../../Components/PageHeader";
import { Pagination } from "../../Components/Pagination";
import { ProjectStatusBadge } from "../../Components/ProjectStatusBadge";
import { timeAgo } from "../../lib/format";
import type { Pagination as PaginationData, Project } from "../../types";

interface Props {
  title: string;
  projects: Project[];
  pagination: PaginationData;
  search: string;
}

/** /projects?search=…&page=…, leaving out what is empty. */
function listUrl(search: string, page = 1): string {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return route("projects") + (query ? `?${query}` : "");
}

function Projects({ title, projects, pagination, search }: Props) {
  const [query, setQuery] = useState(search);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const first = useRef(true);

  // Search as the user types, a beat after they stop. `preserveState` keeps the input
  // focused, and `replace` keeps every keystroke out of the back button's history.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      router.get(
        listUrl(query.trim()),
        {},
        { preserveState: true, preserveScroll: true, replace: true },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const filtered = search !== "";

  return (
    <>
      <Head title={title} />

      <PageHeader
        title="Projects"
        description="Everything you are working on, in one place."
        actions={
          <ButtonLink href={route("projects.create")}>
            <PlusIcon className="size-4" />
            New project
          </ButtonLink>
        }
      />

      {pagination.total === 0 && !filtered ? (
        <EmptyState
          icon={FolderIcon}
          title="No projects yet"
          description="Projects are where your work lives. Create the first one to see how the list, the form and the policy fit together."
          action={
            <ButtonLink href={route("projects.create")}>
              <PlusIcon className="size-4" />
              Create a project
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search projects"
              placeholder="Search by name or description"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {projects.length === 0 ? (
            <EmptyState
              icon={SearchIcon}
              title="No matches"
              description={`Nothing matches “${search}”.`}
              action={
                <Button variant="secondary" onClick={() => setQuery("")}>
                  Clear the search
                </Button>
              }
            />
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-border">
                {projects.map((project) => (
                  <li key={project.id} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={route("projects.edit", { project: project.id })}
                          className="truncate font-medium hover:underline"
                        >
                          {project.name}
                        </Link>
                        <ProjectStatusBadge status={project.status} />
                      </div>
                      {project.description ? (
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {project.description}
                        </p>
                      ) : null}
                    </div>
                    <p className="hidden shrink-0 text-sm text-muted-foreground sm:block">
                      Updated {timeAgo(project.updatedAt)}
                    </p>
                    <div className="flex shrink-0 gap-1">
                      <ButtonLink
                        href={route("projects.edit", { project: project.id })}
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${project.name}`}
                      >
                        <PencilIcon className="size-4" />
                      </ButtonLink>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${project.name}`}
                        onClick={() => setDeleting(project)}
                      >
                        <TrashIcon className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Pagination
            pagination={pagination}
            href={(page) => listUrl(search, page)}
            noun="projects"
          />
        </div>
      )}

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        description="The project is removed for good. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                deleting &&
                router.delete(route("projects.destroy", { project: deleting.id }), {
                  preserveScroll: true,
                  onFinish: () => setDeleting(null),
                })
              }
            >
              Delete project
            </Button>
          </>
        }
      />
    </>
  );
}

Projects.layout = (page: ReactNode) => <AppLayout>{page}</AppLayout>;

export default Projects;
