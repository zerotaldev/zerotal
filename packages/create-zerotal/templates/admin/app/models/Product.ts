import { BaseModel, column, table } from "zerotal/orm";

/**
 * Something the shop sells. Soft-deleted, so a discontinued product can be
 * restored rather than lost.
 */
@table("products")
export class Product extends BaseModel {
  static override softDeletes = true;
  static override fillable = ["name", "sku", "description", "price", "stock", "status", "featured"];

  @column() name!: string;
  @column() sku!: string;
  @column({ nullable: true }) description?: string;
  /** Price in minor units, so money never rides on a float. */
  @column("integer") price!: number;
  @column({ cast: "integer", nullable: true }) stock?: number;
  /** draft | active | discontinued — drives the filter tabs and a select column. */
  @column({ nullable: true }) status?: string;
  @column({ cast: "boolean", nullable: true }) featured?: boolean;
}
