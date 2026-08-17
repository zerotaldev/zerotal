import { Model, belongsTo, column, table } from "zerotal/orm";
import type { BelongsTo } from "zerotal/orm";
import { User } from "./User.ts";
import { Issue } from "./Issue.ts";

/** One message on an issue thread. */
@table("comments")
export class Comment extends Model {
  static override fillable = ["body"];

  @column({ type: "number" }) issueId!: number;
  @column({ type: "number" }) authorId!: number;
  @column({ type: "string" }) body!: string;

  @belongsTo(() => Issue, { foreignKey: "issueId" })
  issue!: BelongsTo<Issue>;

  @belongsTo(() => User, { foreignKey: "authorId" })
  author!: BelongsTo<User>;
}
