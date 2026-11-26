import { Migration, Schema } from "zerotal/orm";

export default class CreateUsersTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email").unique();
      table.string("password");
      table.string("role").nullable().default("user");
      // Set when the address is confirmed; null until then. See EmailVerification.
      table.timestamp("email_verified_at").nullable();
      // Two-factor: the TOTP secret, the hashed recovery codes, and when the first code
      // was confirmed. Sign-in only asks for a code once all three are in place.
      table.string("two_factor_secret").nullable();
      table.text("two_factor_recovery_codes").nullable();
      table.timestamp("two_factor_confirmed_at").nullable();
      // The time step of the last code accepted. A code from that step or an earlier
      // one is refused, so each code works once.
      table.integer("two_factor_last_counter").nullable();
      table.rememberToken();
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    await Schema.drop("users");
  }
}
