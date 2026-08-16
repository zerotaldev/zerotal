import { Model, belongsTo, column, hasMany, manyToMany, table } from "zerotal/orm";
import type { BelongsTo, HasMany, ManyToMany } from "zerotal/orm";
import { Carbon } from "zerotal/carbon";
import { User } from "./User.ts";
import { Project } from "./Project.ts";
import { Label } from "./Label.ts";
import { Comment } from "./Comment.ts";

/**
 * The status column an issue sits in, in board order.
 *
 * A const array rather than a TypeScript enum so the same values can be sent to
 * the browser as data — the board renders its columns from this list, and a
 * status the server has never heard of cannot appear in the UI.
 */
export const ISSUE_STATUSES = ["backlog", "todo", "in_progress", "done", "cancelled"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

/** How the issue list may be ordered. Shared with the query string that sets it. */
export const ISSUE_SORTS = ["newest", "oldest", "priority", "title"] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

/**
 * The unit of work.
 *
 * Soft-deleted, because "where did that issue go" is a support question and a
 * hard delete has no answer to it. `dueAt` is cast to Carbon so every app formats
 * a date the same way rather than each doing its own arithmetic on a string.
 */
@table("issues")
export class Issue extends Model {
  static override fillable = ["title", "body", "status", "priority", "assigneeId", "dueAt"];

  @column({ type: "number" }) projectId!: number;
  @column({ type: "number" }) authorId!: number;
  @column({ type: "number", nullable: true }) assigneeId?: number | null;

  @column({ type: "string" }) title!: string;
  @column({ type: "string", nullable: true }) body?: string | null;
  @column({ type: "string", default: "backlog" }) status!: IssueStatus;
  @column({ type: "string", default: "medium" }) priority!: IssuePriority;
  @column({ type: "number", default: 0 }) position!: number;
  @column({ type: "datetime", cast: "datetime", nullable: true }) dueAt?: Carbon | null;

  @belongsTo(() => Project, { foreignKey: "projectId" })
  project!: BelongsTo<Project>;

  @belongsTo(() => User, { foreignKey: "authorId" })
  author!: BelongsTo<User>;

  @belongsTo(() => User, { foreignKey: "assigneeId" })
  assignee!: BelongsTo<User>;

  @hasMany(() => Comment, { foreignKey: "issueId" })
  comments!: HasMany<Comment>;

  @manyToMany(() => Label, {
    pivotTable: "issue_label",
    pivotForeignKey: "issue_id",
    pivotRelatedKey: "label_id",
  })
  labels!: ManyToMany<Label>;

  /**
   * Apply validated form input, narrowing the two columns the rules could not.
   *
   * `r.string().in([...])` guarantees the value at runtime but returns `string`:
   * it takes a `string[]`, so there is no literal type left for it to narrow to.
   * The two casts in this application live here — one place, next to the columns
   * they are about, rather than at every call site — and anything not in the
   * list has already thrown by the time this runs.
   */
  fillValidated(input: {
    title: string;
    body?: string | undefined;
    status: string;
    priority: string;
    assigneeId?: number | null | undefined;
  }): this {
    return this.fill({
      ...input,
      status: input.status as IssueStatus,
      priority: input.priority as IssuePriority,
    } as never);
  }

  // ── Scopes ─────────────────────────────────────────────────────────────────
  //
  // The issue list's filtering and sorting lives here rather than beside the
  // route, because all three cookbook builds render that list and a rule kept
  // next to one of them is a rule the other two can quietly disagree with. The
  // model is the thing they share.

  /**
   * Free-text search across the title and the body.
   *
   * Both, because someone searching "telemetry" means the word, not the
   * heading. `%` and `_` in the term are escaped so a literal one cannot widen
   * the match into "everything".
   */
  static search = this.scope((q, term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    const like = `%${trimmed.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    q.where((sub) => sub.where("title", "like", like).orWhere("body", "like", like));
  });

  /** Narrow to one status, or leave the list alone when none is given. */
  static withStatus = this.scope((q, status: IssueStatus | null) => {
    if (status) q.where("status", status);
  });

  static withPriority = this.scope((q, priority: IssuePriority | null) => {
    if (priority) q.where("priority", priority);
  });

  static assignedTo = this.scope((q, userId: number | null) => {
    if (userId) q.where("assignee_id", userId);
  });

  /** Everything not finished — what "open" means on a project card. */
  static open = this.scope((q) => {
    q.whereNotIn("status", ["done", "cancelled"]);
  });

  /**
   * Sort, in urgency order where the sort is by priority.
   *
   * SQLite has no enum, so `ORDER BY priority` sorts `high, low, medium, urgent`
   * — which reads as sorted and is not. The CASE makes the intended order
   * explicit and travels with the model rather than being re-derived per build.
   */
  static sorted = this.scope((q, sort: IssueSort) => {
    switch (sort) {
      case "oldest":
        q.orderBy("created_at", "asc");
        break;
      case "title":
        q.orderBy("title", "asc");
        break;
      case "priority":
        q.orderByRaw(
          `CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END asc`,
        );
        q.orderBy("created_at", "desc");
        break;
      default:
        q.orderBy("created_at", "desc");
    }
  });
}
