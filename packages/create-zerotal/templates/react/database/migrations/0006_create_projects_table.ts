import { Migration, Schema } from "zerotal/orm";

export default class CreateProjectsTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("projects", (table) => {
      table.increments("id");
      // The owner. Indexed: every list of projects is one user's.
      table.integer("user_id").index();
      table.string("name");
      table.text("description").nullable();
      table.string("status").default("planning");
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    await Schema.drop("projects");
  }
}
