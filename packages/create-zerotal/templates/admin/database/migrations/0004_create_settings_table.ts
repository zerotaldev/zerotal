import { Migration, Schema } from "zerotal/orm";

/**
 * Site-wide configuration — one row, edited through the singular settings
 * resource. Mirrors `app/models/Setting.ts`.
 */
export default class CreateSettingsTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("settings", (table) => {
      table.increments("id");
      table.string("site_name");
      table.string("support_email").nullable();
      table.boolean("orders_open").nullable();
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    await Schema.drop("settings");
  }
}
