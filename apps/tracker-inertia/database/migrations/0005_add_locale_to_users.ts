import { Migration, Schema } from "zerotal/orm";

/**
 * A language per person — feature 12.
 *
 * Nullable, and null means "decide from the request". A stored locale is a
 * deliberate choice; the absence of one is not a preference for English, it is
 * the absence of a choice, and the resolver chain should still get to read the
 * Accept-Language header for those people.
 *
 * On `users` rather than a settings table because it is one column and the
 * queue needs it: a notification rendered in a worker has no request to ask,
 * so the recipient's row is the only place the answer can come from.
 */
export default class AddLocaleToUsers extends Migration {
  async up(): Promise<void> {
    await Schema.table("users", (table) => {
      table.string("locale").nullable();
    });
  }

  async down(): Promise<void> {
    await Schema.table("users", (table) => {
      table.dropColumn("locale");
    });
  }
}
