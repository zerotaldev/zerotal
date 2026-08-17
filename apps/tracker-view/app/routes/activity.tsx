import { view } from "zerotal";
import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware } from "zerotal/auth";
import { AuditLog } from "@zerotal/audit";
import { User } from "@app/models/User.ts";
import { Issue } from "@app/models/Issue.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../resources/views/layouts/AppLayout.tsx";
import { Card, EmptyState, PageHeader } from "../../resources/views/components/Ui.tsx";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/** The feed is a recent history, not an archive. */
const LIMIT = 100;

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
 * "Assignee" and "In progress". This is the translation *of the schema*, and it
 * has to happen before `__()` can do anything — a column name is not a sentence.
 * An unmapped value falls through to itself, so a new event type appears in the
 * trail as its raw name instead of disappearing from it.
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
 * GET /activity — the trail, read as sentences.
 *
 * `audit_logs` has no relations to eager-load: it stores `actorId` and
 * `auditableId` as loose columns precisely so the trail survives the row it
 * describes being deleted. That is the right trade for an audit table and it
 * means resolving names is this route's job.
 *
 * Two extra queries, not two hundred. The ids are collected from the page of
 * entries first and fetched with one `whereIn` each — the N+1 this page invites
 * is a lookup per row, and it would be invisible until the trail got long.
 */
export const GET = async (http: HttpContext) => {
  const entries = await AuditLog.query().orderBy("created_at", "desc").limit(LIMIT).get();

  const actorIds = [...new Set(entries.map((e) => e.actorId).filter((id): id is number => !!id))];
  const issueIds = [
    ...new Set(
      entries
        .filter((e) => e.auditableType === "Issue" && e.auditableId)
        .map((e) => Number(e.auditableId))
        .filter((id) => Number.isInteger(id)),
    ),
  ];

  const actors = actorIds.length ? await User.query().whereIn("id", actorIds).get() : [];
  const issues = issueIds.length
    ? await Issue.query().whereIn("id", issueIds).with("project").get()
    : [];

  const actorById = new Map(actors.map((user) => [user.id, user.name]));
  const issueById = new Map(
    issues.map((issue) => [
      issue.id,
      { title: issue.title, projectSlug: issue.project?.slug ?? null },
    ]),
  );

  const user = Auth.userOrNull();

  view(
    <AppLayout
      title={__("Activity")}
      active="activity"
      user={user ? { name: user.name, email: user.email } : null}
      flash={{ success: http.session?.get<string>("success") ?? null }}
    >
      <div class="max-w-3xl space-y-6">
        <PageHeader
          title={__("Activity")}
          description={__("Every change, most recent first.")}
        />

        {entries.length === 0 ? (
          <Card>
            <EmptyState
              title={__("Nothing has changed yet")}
              description={__(
                "Once issues are created and edited, the trail of who changed what will appear here.",
              )}
            />
          </Card>
        ) : (
          <ul class="space-y-2">
            {entries.map((entry) => {
              const subject =
                entry.auditableType === "Issue"
                  ? issueById.get(Number(entry.auditableId))
                  : undefined;
              const actor = entry.actorId ? (actorById.get(entry.actorId) ?? null) : null;
              const changes = diff(entry.oldValues, entry.newValues);

              return (
                <li class="rounded-xl border border-border bg-card p-4">
                  <p class="text-sm">
                    <span class="font-medium text-foreground">
                      {/* A queued job or a seeder has no signed-in user. Saying so
                          is better than attributing the change to nobody. */}
                      {actor ?? __("The system")}
                    </span>{" "}
                    <span
                      class={`mx-0.5 inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${
                        TONE[entry.event] ?? TONE["restored"]
                      }`}
                    >
                      {__(VERB[entry.event] ?? entry.event)}
                    </span>{" "}
                    {subject?.title && subject.projectSlug && entry.auditableId ? (
                      <a
                        href={route("projects.issues.show", {
                          project: subject.projectSlug,
                          issue: String(entry.auditableId),
                        })}
                        class="font-medium text-foreground hover:underline"
                      >
                        {subject.title}
                      </a>
                    ) : (
                      <span class="text-muted-foreground">
                        {entry.auditableType}
                        {entry.auditableId ? ` #${String(entry.auditableId)}` : ""}
                      </span>
                    )}
                  </p>

                  {changes.length > 0 ? (
                    <ul class="mt-2 space-y-1">
                      {changes.map((change) => (
                        <li class="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span class="font-medium text-foreground">
                            {__(FIELD[change.field] ?? change.field)}
                          </span>
                          <span class="truncate">{change.from ?? "—"}</span>
                          <span aria-hidden="true">→</span>
                          <span class="truncate text-foreground">{change.to ?? "—"}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {entry.createdAt ? (
                    <p class="mt-2 text-xs text-muted-foreground">
                      {entry.createdAt.toISOString()}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppLayout>,
  );
};

/** Field-by-field before/after, skipping anything that did not change. */
function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { field: string; from: string | null; to: string | null }[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];

  return keys
    .map((field) => ({
      field,
      from: format(before?.[field]),
      to: format(after?.[field]),
    }))
    .filter((change) => change.from !== change.to);
}

function format(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}
