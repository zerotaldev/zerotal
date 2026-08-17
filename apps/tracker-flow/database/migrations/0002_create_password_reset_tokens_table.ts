import { Migration, Schema } from "zerotal/orm";

/**
 * One live reset token per address, keyed by email rather than user id so a
 * request for an unknown address does the same work as a known one — the
 * response must not reveal which addresses have accounts.
 *
 * `token` holds a SHA-256 hash, never the value that was sent: a leaked
 * database should not hand out working reset links.
 */
export default class CreatePasswordResetTokensTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("password_reset_tokens", (table) => {
      table.string("email").primary();
      table.string("token");
      table.timestamp("created_at");
    });
  }

  async down(): Promise<void> {
    await Schema.drop("password_reset_tokens");
  }
}
