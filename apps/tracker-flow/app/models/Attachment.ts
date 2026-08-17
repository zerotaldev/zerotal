import { Model, belongsTo, column, table } from "zerotal/orm";
import type { BelongsTo } from "zerotal/orm";
import { User } from "./User.ts";
import { Issue } from "./Issue.ts";

/**
 * One file attached to an issue.
 *
 * `fillable` is empty on purpose. Every column here is either generated
 * (`path`), derived from the uploaded file (`mime`, `size`, `originalName`) or
 * taken from the request context (`issueId`, `uploaderId`) — none of it may
 * arrive from a request body. A fillable `path` would let a request name the key
 * its bytes are written to, and a fillable `uploaderId` would let it name
 * somebody else as the uploader.
 */
@table("attachments")
export class Attachment extends Model {
  static override fillable = [];

  @column({ type: "number" }) issueId!: number;
  @column({ type: "number" }) uploaderId!: number;
  @column({ type: "string" }) path!: string;
  @column({ type: "string" }) originalName!: string;
  @column({ type: "string" }) mime!: string;
  @column({ type: "number" }) size!: number;

  @belongsTo(() => Issue, { foreignKey: "issueId" })
  issue!: BelongsTo<Issue>;

  @belongsTo(() => User, { foreignKey: "uploaderId" })
  uploader!: BelongsTo<User>;
}
