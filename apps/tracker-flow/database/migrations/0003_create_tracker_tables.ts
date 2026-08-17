import { Migration, Schema } from "zerotal/orm";

/**
 * Tracker's own tables.
 *
 * One migration rather than five because they are one unit — the foreign keys
 * point at each other, and half of this schema is not a state the app can run
 * in. The three cookbook apps share this file byte-for-byte (see
 * `scripts/cookbook-sync.ts`), so it is the one place the domain is defined.
 */
export default class CreateTrackerTables extends Migration {
  async up(): Promise<void> {
    await Schema.create("projects", (table) => {
      table.increments("id");
      table.string("name");
      table.string("slug").unique();
      table.text("description").nullable();
      table.foreignId("owner_id").constrained("users");
      table.timestamps();
    });

    await Schema.create("labels", (table) => {
      table.increments("id");
      table.string("name").unique();
      // A token name (`sky`, `amber`), not a hex — the palette lives in CSS, so a
      // label cannot introduce a colour the theme has never heard of.
      table.string("colour").default("zinc");
      table.timestamps();
    });

    await Schema.create("issues", (table) => {
      table.increments("id");
      table.foreignId("project_id").constrained("projects");
      table.foreignId("author_id").constrained("users");
      table.foreignId("assignee_id").nullable().constrained("users").nullOnDelete();
      table.string("title");
      table.text("body").nullable();
      table.string("status").default("backlog");
      table.string("priority").default("medium");
      // Position within its status column on the board. Sparse on purpose —
      // reordering rewrites one row rather than renumbering the column.
      table.integer("position").default(0);
      table.dateTime("due_at").nullable();
      table.timestamps();
      table.softDeletes();

      // The board and the issue list both filter on these two together, and the
      // list is the page this app is judged on.
      table.index(["project_id", "status"]);
    });

    await Schema.create("issue_label", (table) => {
      table.increments("id");
      table.foreignId("issue_id").constrained("issues");
      table.foreignId("label_id").constrained("labels");
      table.unique(["issue_id", "label_id"]);
    });

    await Schema.create("comments", (table) => {
      table.increments("id");
      table.foreignId("issue_id").constrained("issues");
      table.foreignId("author_id").constrained("users");
      table.text("body");
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    // Reverse order: a table cannot be dropped while another still points at it.
    await Schema.drop("comments");
    await Schema.drop("issue_label");
    await Schema.drop("issues");
    await Schema.drop("labels");
    await Schema.drop("projects");
  }
}
