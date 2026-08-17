import { Link } from "@inertiajs/react";
import Avatar from "./Avatar";

export interface ProjectRow {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  owner: { name: string } | null;
  issueCount: number;
}

/**
 * One project, as a card.
 *
 * The card *is* the link — an `<a>` wrapping the content rather than a `<div>`
 * with a click handler — so it is reachable by Tab, openable in a new tab, and
 * announced as a link without any of that having to be re-added with ARIA.
 *
 * Three tiers, in the order someone scanning a grid needs them: what the project
 * is called, what it is for, and how much is in it. The owner sits below a rule
 * because it answers a question nobody asked first.
 */
export default function ProjectCard({ project }: { project: ProjectRow }) {
  return (
    <Link
      href={route("projects.show", { project: project.slug })}
      className="flex h-full flex-col rounded-xl border border-border bg-card p-5 transition-[border-color,box-shadow] duration-150 hover:border-muted-foreground/30 hover:shadow-sm"
    >
      <h2 className="truncate text-[0.9375rem] font-semibold text-card-foreground">
        {project.name}
      </h2>

      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
        {project.description ?? "No description."}
      </p>

      <p className="mt-4 text-sm tabular-nums">
        <span className="font-medium text-foreground">{project.issueCount}</span>{" "}
        <span className="text-muted-foreground">issue{project.issueCount === 1 ? "" : "s"}</span>
      </p>

      {project.owner && (
        <div className="mt-auto flex items-center gap-2 border-t border-border pt-4">
          <Avatar name={project.owner.name} size="sm" />
          <span className="truncate text-xs text-muted-foreground">{project.owner.name}</span>
        </div>
      )}
    </Link>
  );
}
