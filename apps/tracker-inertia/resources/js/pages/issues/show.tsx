import { Head, Link } from "@inertiajs/react";
import TrackerLayout from "../../Layouts/TrackerLayout";
import { LabelChip, PriorityBadge, StatusBadge } from "../../Components/Badge";
import { ButtonLink } from "../../Components/Button";
import EmptyState from "../../Components/EmptyState";

interface Props {
  project: { name: string; slug: string };
  issue: {
    id: number;
    title: string;
    body: string;
    status: string;
    priority: string;
    author: { id: number; name: string } | null;
    assignee: { id: number; name: string } | null;
    labels: { name: string; colour: string }[];
    createdAt: string | null;
    dueAt: string | null;
  };
  comments: {
    id: number;
    body: string;
    author: { name: string } | null;
    createdAt: string | null;
  }[];
  can: { update: boolean };
}

/**
 * One issue: the description, the thread, and the facts down the side.
 *
 * `can.update` decides whether the Edit button is drawn. The route's
 * `Gate.authorize` is what actually enforces it — this only stops the interface
 * offering a door that would shut in your face. Both call the same policy, so
 * they cannot disagree about who may edit.
 */
export default function IssueShow({ project, issue, comments, can }: Props) {
  return (
    <>
      <Head title={`#${issue.id} ${issue.title}`} />

      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground">
          Projects
        </Link>
        <span aria-hidden="true" className="px-1.5">
          /
        </span>
        <Link href={`/projects/${project.slug}`} className="hover:text-foreground">
          {project.name}
        </Link>
        <span aria-hidden="true" className="px-1.5">
          /
        </span>
        <span className="text-foreground">#{issue.id}</span>
      </nav>

      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{issue.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            #{issue.id} · opened by {issue.author?.name ?? "someone since deleted"}
            {issue.createdAt && ` on ${new Date(issue.createdAt).toLocaleDateString()}`}
          </p>
        </div>
        {can.update && (
          <ButtonLink
            href={`/projects/${project.slug}/issues/${issue.id}/edit`}
            variant="secondary"
            size="sm"
          >
            Edit
          </ButtonLink>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="sr-only">Description</h2>
            {issue.body ? (
              // Plain text for now. Markdown rendering is its own recipe, and a
              // half-rendered document is worse than an honest pre-formatted one.
              <p className="text-sm whitespace-pre-wrap text-foreground">{issue.body}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No description was given.</p>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold">
              {comments.length} comment{comments.length === 1 ? "" : "s"}
            </h2>

            {comments.length === 0 ? (
              <div className="mt-3 rounded-xl border border-border bg-card">
                <EmptyState
                  title="No comments yet"
                  description="Nobody has replied to this issue."
                />
              </div>
            ) : (
              <ul className="mt-3 space-y-3">
                {comments.map((comment) => (
                  <li key={comment.id} className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {comment.author?.name ?? "Someone"}
                      </span>
                      {comment.createdAt && ` · ${new Date(comment.createdAt).toLocaleString()}`}
                    </p>
                    <p className="mt-1.5 text-sm whitespace-pre-wrap">{comment.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <dl className="space-y-4 rounded-xl border border-border bg-card p-5 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="mt-1">
                <StatusBadge status={issue.status} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Priority</dt>
              <dd className="mt-1">
                <PriorityBadge priority={issue.priority} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Assignee</dt>
              <dd className="mt-1">{issue.assignee?.name ?? "Unassigned"}</dd>
            </div>
            {issue.labels.length > 0 && (
              <div>
                <dt className="text-xs text-muted-foreground">Labels</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {issue.labels.map((label) => (
                    <LabelChip key={label.name} {...label} />
                  ))}
                </dd>
              </div>
            )}
            {issue.dueAt && (
              <div>
                <dt className="text-xs text-muted-foreground">Due</dt>
                <dd className="mt-1">{new Date(issue.dueAt).toLocaleDateString()}</dd>
              </div>
            )}
          </dl>
        </aside>
      </div>
    </>
  );
}

IssueShow.layout = (page: React.ReactNode) => <TrackerLayout>{page}</TrackerLayout>;
