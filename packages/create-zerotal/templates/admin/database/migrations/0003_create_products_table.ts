import { Migration, Schema } from "zerotal/orm";

/**
 * The demo catalogue. Mirrors `app/models/Product.ts`, which soft-deletes, so
 * the table carries `deleted_at`. `price` is in minor units.
 */
export default class CreateProductsTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("products", (table) => {
      table.increments("id");
      table.string("name");
      table.string("sku");
      table.text("description").nullable();
      table.integer("price");
      table.integer("stock").nullable();
      table.string("status").nullable();
      table.boolean("featured").nullable();
      table.timestamps();
      table.softDeletes();
    });
  }

  async down(): Promise<void> {
    await Schema.drop("products");
  }
}
