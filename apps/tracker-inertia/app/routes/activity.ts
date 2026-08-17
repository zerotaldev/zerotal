import { Inertia } from "@zerotal/inertia";
import { AuthMiddleware } from "zerotal/auth";
import { AuditLog } from "@zerotal/audit";
import { User } from "@app/models/User.ts";
import { Issue } from "@app/models/Issue.ts";

export const middleware = [AuthMiddleware];

/** The feed is a recent history, not an archive. */
const LIMIT = 100;

/**
 * GET /activity — feature 11.
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
export const GET = async () => {
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

  return Inertia.render("activity", {
    title: "Activity",
    entries: entries.map((entry) => {
      const subject =
        entry.auditableType === "Issue" ? issueById.get(Number(entry.auditableId)) : undefined;

      return {
        id: entry.id,
        event: entry.event,
        subjectType: entry.auditableType,
        subjectId: entry.auditableId,
        subjectTitle: subject?.title ?? null,
        projectSlug: subject?.projectSlug ?? null,
        actor: entry.actorId ? (actorById.get(entry.actorId) ?? null) : null,
        // Only the fields that actually moved. The trail stores both sides; the
        // feed reads better as "status: todo → done" than as two objects.
        changes: diff(entry.oldValues, entry.newValues),
        createdAt: entry.createdAt?.toISOString?.() ?? null,
      };
    }),
  });
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
