import { Migration, Schema } from "zerotal/orm";

export default class CreateUsersTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email").unique();
      table.string("password");
      table.string("role").nullable().default("user");
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    await Schema.drop("users");
  }
}
