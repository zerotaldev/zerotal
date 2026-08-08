import { BaseModelWith, column, table } from "zerotal/orm";
import { Authenticatable } from "zerotal/auth";

/**
 * A person who signs into the panel. Also the author side of the blog: posts
 * belong to a user.
 */
@table("users")
export class User extends BaseModelWith(Authenticatable) {
  static override hidden = ["password"];
  static override fillable = ["name", "email", "password", "roles", "avatarUrl"];

  @column() name!: string;
  @column() email!: string;
  @column() password!: string;
  /** Assigned roles — drives a multi-select field and a badge column. */
  @column({ cast: "json", nullable: true }) roles?: string[] | undefined;
  /** Profile picture, shown as a circular image entry on the view page. */
  @column({ nullable: true }) avatarUrl?: string | undefined;
}
