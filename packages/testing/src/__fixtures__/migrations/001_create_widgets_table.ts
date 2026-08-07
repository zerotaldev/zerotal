import { Migration, Schema } from "@zerotal/orm";

export default class CreateWidgetsTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("widgets", (table) => {
      table.increments("id");
      table.string("name");
    });
  }

  async down(): Promise<void> {
    await Schema.dropIfExists("widgets");
  }
}
