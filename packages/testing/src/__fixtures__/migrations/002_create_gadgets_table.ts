import { Migration, Schema } from "@zerotal/orm";

export default class CreateGadgetsTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("gadgets", (table) => {
      table.increments("id");
      table.integer("widget_id");
    });
  }

  async down(): Promise<void> {
    await Schema.dropIfExists("gadgets");
  }
}
