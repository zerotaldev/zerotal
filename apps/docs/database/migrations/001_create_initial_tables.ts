import { Migration, Schema } from "@zerotal/orm";

/**
 * The site's whole schema: the author account, the posts it writes, and the
 * roles/permissions tables `@zerotal/auth` expects behind `AuthUser`.
 *
 * Local development builds this from the models at boot (`synchronize` in
 * `config/database.ts`), so this file exists for production, where synchronize
 * is off and `zt migrate` is the only thing that creates tables.
 *
 * Started from `zt migrate:generate`, then corrected in three places the model
 * decorators cannot express — noted inline.
 */
export default class CreateInitialTables extends Migration {
  override async up(): Promise<void> {
    await Schema.create("permissions", (table) => {
      table.increments("id");
      table.string("name");
      table.string("guard");
      table.string("label").nullable();
      table.timestamps();
    });

    await Schema.create("roles", (table) => {
      table.increments("id");
      table.string("name");
      table.string("guard");
      table.string("label").nullable();
      table.timestamps();
    });

    await Schema.create("users", (table) => {
      table.increments("id");
      table.string("name");
      // Unique: `Auth.attempt()` looks an account up by email, so two rows
      // sharing one would make which account you signed into arbitrary.
      table.string("email").unique();
      table.string("password");
      table.string("remember_token").nullable();
      table.timestamps();
    });

    await Schema.create("posts", (table) => {
      table.increments("id");
      // Unique: the slug is the route key (`Post.resolveRouteBinding`), and
      // `Post.uniqueSlug()` already refuses to hand out a duplicate. The index
      // makes that a guarantee rather than a convention, and every `/blog/:slug`
      // read goes through it.
      table.string("slug").unique();
      table.string("title");
      table.string("description").nullable();
      table.string("category").nullable();
      // `text`, not `string`: an article is not 255 characters. The model says
      // `@column("text")`, but that shorthand registers as a string type, so the
      // generated migration proposed varchar — harmless on SQLite, truncating on
      // Postgres.
      table.text("body");
      // Indexed: every public listing filters on it (published, not future).
      table.dateTime("published_at").nullable().index();
      table.integer("author_id").nullable();
      table.timestamps();
    });
  }

  override async down(): Promise<void> {
    await Schema.dropIfExists("posts");
    await Schema.dropIfExists("users");
    await Schema.dropIfExists("roles");
    await Schema.dropIfExists("permissions");
  }
}
