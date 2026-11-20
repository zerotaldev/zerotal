import { Migration, Schema } from "zerotal/orm";

/**
 * The people who sign into the panel. Mirrors `app/models/User.ts`: `roles` is
 * a JSON list, and `remember_token` is the column the Authenticatable mixin
 * reads for "remember me".
 *
 * Numbered after the password-reset table because that migration shipped
 * first and apps may already have run it; the two tables do not depend on
 * each other, so the order does not matter.
 */
export default class CreateUsersTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email").unique();
      table.string("password");
      table.json("roles").nullable();
      table.string("avatar_url").nullable();
      table.rememberToken();
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    await Schema.drop("users");
  }
}
