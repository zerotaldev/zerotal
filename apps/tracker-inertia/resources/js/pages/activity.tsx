import type { ReactNode } from "react";
import { Head, Link } from "@inertiajs/react";
import AppShell from "../Layouts/AppShell";
import PageHeader from "../Components/PageHeader";
import EmptyState from "../Components/EmptyState";
import Avatar from "../Components/Avatar";
import { ClockIcon } from "../Components/Icons";
import { cn } from "../lib/cn";

interface Entry {
  id: number;
  event: string;
  subjectType: string;
  subjectId: string | null;
  subjectTitle: string | null;
  projectSlug: string | null;
  actor: string | null;
  changes: { field: string; from: string | null; to: string | null }[];
  createdAt: string | null;
}

interface Props {
  title: string;
  entries: Entry[];
}

const TONE: Record<string, string> = {
  created: "bg-success/15 text-success",
  updated: "bg-primary/12 text-primary",
  deleted: "bg-destructive/12 text-destructive",
  restored: "bg-muted text-muted-foreground",
};

/**
 * Stored values → the English words that describe them.
 *
 * The audit table records `assigneeId` and `in_progress`; a person reads
 * "Assignee" and "In progress". These maps are the translation *of the schema*,
 * and they have to exist independently of the language: `__()` cannot be handed
 * a column name and be expected to produce a sentence.
 *
 * An unmapped value falls through to itself, which is why a new event type
 * appears in the trail as its raw name instead of disappearing from it.
 */
const VERB: Record<string, string> = {
  created: "created",
  updated: "updated",
  deleted: "deleted",
  restored: "restored",
};

const FIELD: Record<string, string> = {
  title: "Title",
  status: "Status",
  priority: "Priority",
  assigneeId: "Assignee",
};

/**
 * The trail, read as sentences.
 *
 * The audit table stores two JSON blobs per entry; nobody wants to read those.
 * The route reduces them to the fields that actually moved and this renders each
 * as `Status  todo → done`, which is the form the question was asked in.
 */
function Activity({ title, entries }: Props) {
  return (
    <>
      <Head title={title} />

      <div className="max-w-3xl space-y-6">
        <PageHeader title={__("Activity")} description={__("Every change, most recent first.")} />

        {entries.length === 0 ? (
          <div className="rounded-xl border border-border bg-card">
            <EmptyState
              icon={<ClockIcon className="size-5" />}
              title={__("Nothing has changed yet")}
              description={__("Once issues are created and edited, the trail of who changed what will appear here.")}
            />
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  {entry.actor ? (
                    <Avatar name={entry.actor} size="sm" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[0.625rem] text-muted-foreground"
                    >
                      ?
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium text-foreground">
                        {/* A queued job or a seeder has no signed-in user. Saying so
                            is better than attributing the change to nobody in particular. */}
                        {entry.actor ?? __("The system")}
                      </span>{" "}
                      <span
                        className={cn(
                          "mx-0.5 inline-flex rounded px-1.5 py-0.5 text-xs font-medium",
                          TONE[entry.event] ?? TONE["restored"],
                        )}
                      >
                        {__(VERB[entry.event] ?? entry.event)}
                      </span>{" "}
                      {entry.subjectTitle && entry.projectSlug && entry.subjectId ? (
                        <Link
                          href={route("projects.issues.show", {
                            project: entry.projectSlug,
                            issue: entry.subjectId,
                          })}
                          className="font-medium text-foreground hover:underline"
                        >
                          {entry.subjectTitle}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          {entry.subjectType}
                          {entry.subjectId ? ` #${entry.subjectId}` : ""}
                        </span>
                      )}
                    </p>

                    {entry.changes.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {entry.changes.map((change) => (
                          <li
                            key={change.field}
                            className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
                          >
                            <span className="font-medium text-foreground">
                              {__(FIELD[change.field] ?? change.field)}
                            </span>
                            <span className="truncate">{change.from ?? "—"}</span>
                            <span aria-hidden="true">→</span>
                            <span className="truncate text-foreground">{change.to ?? "—"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {entry.createdAt && (
                    <time
                      dateTime={entry.createdAt}
                      className="shrink-0 text-xs text-muted-foreground"
                    >
                      {new Date(entry.createdAt).toLocaleString()}
                    </time>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

Activity.layout = (page: ReactNode) => <AppShell>{page}</AppShell>;

export default Activity;
