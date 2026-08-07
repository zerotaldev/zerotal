import { BaseModel, column, table } from "zerotal/orm";

/**
 * Site-wide configuration — exactly one row, edited through a singular resource
 * rather than a list. See `app/admin/SettingsResource.ts`.
 */
@table("settings")
export class Setting extends BaseModel {
  static override fillable = ["siteName", "supportEmail", "ordersOpen"];

  @column() siteName!: string;
  @column({ nullable: true }) supportEmail?: string;
  @column({ cast: "boolean", nullable: true }) ordersOpen?: boolean;
}
