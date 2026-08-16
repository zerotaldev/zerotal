import { Model, belongsTo, column, hasMany, table } from "zerotal/orm";
import type { BelongsTo, HasMany } from "zerotal/orm";
import { Str } from "zerotal";
import { User } from "./User.ts";
import { Issue } from "./Issue.ts";

/**
 * A container for issues, owned by one user.
 *
 * Addressed by slug everywhere — `/projects/apollo`, not `/projects/3` — so the
 * route binding resolves that way and a URL survives a database reseed.
 */
@table("projects")
export class Project extends Model {
  static override fillable = ["name", "description"];

  @column({ type: "string" }) name!: string;
  @column({ type: "string" }) slug!: string;
  @column({ type: "string", nullable: true }) description?: string | null;
  @column({ type: "number" }) ownerId!: number;

  @belongsTo(() => User, { foreignKey: "ownerId" })
  owner!: BelongsTo<User>;

  @hasMany(() => Issue, { foreignKey: "projectId" })
  issues!: HasMany<Issue>;

  /** Resolve `/projects/:project` by slug rather than primary key. */
  static async resolveRouteBinding(value: string): Promise<Project> {
    return Project.query().where("slug", value).firstOrFail() as Promise<Project>;
  }

  /**
   * Derive the slug from the name when one was not given.
   *
   * On the model rather than in the controller because three apps create
   * projects and a slug that differs between them is a URL that differs between
   * them — and the URLs are part of what the cookbook claims is identical.
   */
  static slugFor(name: string): string {
    return Str.slugify(name);
  }
}
