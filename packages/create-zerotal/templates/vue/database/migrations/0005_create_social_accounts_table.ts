import { Migration, Schema } from "zerotal/orm";

/**
 * Which GitHub or Google account signs in as which user. A table rather than columns on
 * `users`, so one person can link both.
 */
export default class CreateSocialAccountsTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("social_accounts", (table) => {
      table.increments("id");
      table.integer("user_id").index();
      table.string("provider");
      table.string("provider_id");
      table.timestamps();
      table.unique(["provider", "provider_id"]);
    });
  }

  async down(): Promise<void> {
    await Schema.drop("social_accounts");
  }
}
