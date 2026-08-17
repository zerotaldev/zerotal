import { Migration, Schema } from "zerotal/orm";

/**
 * Files attached to an issue — feature 8.
 *
 * The row stores where the bytes went, not the bytes. `path` is a key on a
 * storage disk, so the same schema works whether the disk is local or S3 and
 * nothing has to migrate when that changes.
 *
 * `original_name` is kept alongside the stored `path` because the two are
 * deliberately different: the path is generated, so a second upload of
 * `screenshot.png` cannot overwrite the first, and an upload cannot choose where
 * it lands. The original name is what the reader is shown and what they get
 * back on download.
 *
 * Shared byte-for-byte with the other two builds.
 */
export default class CreateAttachmentsTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("attachments", (table) => {
      table.increments("id");
      table.foreignId("issue_id").constrained("issues");
      table.foreignId("uploader_id").constrained("users");
      /** Storage key, e.g. `attachments/12/a1b2c3.png`. Never shown to a reader. */
      table.string("path").unique();
      table.string("original_name");
      table.string("mime");
      /** Bytes. Recorded at write time so listing a thread needs no stat calls. */
      table.integer("size");
      table.timestamps();

      // The issue page lists these; nothing else queries the table.
      table.index(["issue_id"]);
    });
  }

  async down(): Promise<void> {
    await Schema.drop("attachments");
  }
}
