import { Model, column, manyToMany, table } from "zerotal/orm";
import type { ManyToMany } from "zerotal/orm";
import { Issue } from "./Issue.ts";

/**
 * A tag an issue can carry.
 *
 * `colour` is a token name — `sky`, `amber`, `zinc` — resolved against the
 * theme, never a hex. A label cannot introduce a colour the palette has not got,
 * which is what keeps three apps rendering the same label identically.
 */
@table("labels")
export class Label extends Model {
  static override fillable = ["name", "colour"];

  @column({ type: "string" }) name!: string;
  @column({ type: "string", default: "zinc" }) colour!: string;

  @manyToMany(() => Issue, {
    pivotTable: "issue_label",
    pivotForeignKey: "label_id",
    pivotRelatedKey: "issue_id",
  })
  issues!: ManyToMany<Issue>;
}
