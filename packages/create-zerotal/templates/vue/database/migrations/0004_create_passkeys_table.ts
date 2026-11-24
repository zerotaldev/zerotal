import { Migration, Schema } from "zerotal/orm";

/**
 * Registered passkeys (WebAuthn credentials). Only the public key is stored — the
 * private key never leaves the user's device. Created whether or not passkeys are
 * switched on, so turning them on later needs no migration.
 */
export default class CreatePasskeysTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("passkeys", (table) => {
      table.increments("id");
      table.integer("user_id").index();
      table.string("credential_id").unique();
      table.text("public_key");
      table.integer("counter").default(0);
      table.string("device_type");
      table.boolean("backed_up").default(false);
      table.text("transports").nullable();
      table.string("name").nullable();
      table.timestamp("last_used_at").nullable();
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    await Schema.drop("passkeys");
  }
}
