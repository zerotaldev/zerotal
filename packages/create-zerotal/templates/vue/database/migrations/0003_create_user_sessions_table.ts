import { Migration, Schema } from "zerotal/orm";

/**
 * One row per signed-in browser, so Settings → Sessions can list them and sign the
 * others out.
 *
 * The session itself lives in a signed cookie, which the server cannot enumerate or
 * revoke. This table is the server's record of each one: app/middleware/TrackSession.ts
 * writes a row on a browser's first signed-in request and checks it on every later
 * one, so deleting a row signs that browser out on its next request.
 */
export default class CreateUserSessionsTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("user_sessions", (table) => {
      table.string("id").primary();
      table.integer("user_id").index();
      table.string("ip_address").nullable();
      table.text("user_agent").nullable();
      table.timestamp("last_active_at");
      table.timestamp("created_at");
    });
  }

  async down(): Promise<void> {
    await Schema.drop("user_sessions");
  }
}
