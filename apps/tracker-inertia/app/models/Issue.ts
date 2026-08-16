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
}
