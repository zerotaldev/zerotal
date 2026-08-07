import { Glob } from "bun";
import { join } from "node:path";
import { basePath, env } from "zerotal";
import { Seeder } from "zerotal/orm";
import { Carbon } from "zerotal/carbon";
import { Hash } from "zerotal/auth";
import { User } from "@app/models/User.ts";
import { Post, POST_CATEGORIES } from "@app/models/Post.ts";
import { parseFrontmatter, extractTitle } from "@app/support/helpers.ts";

const BLOG_DIR = join(basePath("/"), "../../blog");

/** The dev convenience password — never allowed to reach a deployed site. */
const INSECURE_DEFAULT = "password";

/**
 * The password the author account is created with.
 *
 * Outside local development this must be set explicitly. Seeding is a one-shot
 * step that is easy to run and forget, and the account it creates can publish to
 * the live site — so a missing `ADMIN_PASSWORD` stops the seed rather than
 * quietly opening `/admin` with a guessable credential.
 */
function adminPassword(): string {
  const password = env("ADMIN_PASSWORD", "");
  const isLocal = env("APP_ENV", "local") === "local";

  if (!password) {
    if (!isLocal) {
      throw new Error(
        "[seed] ADMIN_PASSWORD is required outside local development — it is the " +
          "password for the account that can publish to the site. Set it and re-run.",
      );
    }
    return INSECURE_DEFAULT;
  }

  if (password === INSECURE_DEFAULT && !isLocal) {
    throw new Error(`[seed] ADMIN_PASSWORD must not be "${INSECURE_DEFAULT}" outside local.`);
  }
  return password;
}

/**
 * The first author, plus the committed `blog/*.md` posts imported as rows.
 *
 * Importing is what makes the file-backed posts editable: `app/support/blog.ts`
 * prefers a row over a file of the same slug, so after this runs every post can
 * be revised at /admin. The files stay in git as the origin of the content.
 *
 * Idempotent — reseeding updates nothing that already exists, so it is safe to
 * re-run against a database you have already been writing to.
 */
export class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    const email = env("ADMIN_EMAIL", "admin@zerotal.dev");
    let author = await User.query().where("email", email).first<User>();

    if (!author) {
      author = (await User.create({
        name: env("ADMIN_NAME", "Zerotal"),
        email,
        password: await Hash.make(adminPassword()),
      })) as User;
    }

    for await (const file of new Glob("*.md").scan({ cwd: BLOG_DIR })) {
      const slug = file.replace(/\.md$/, "");
      if (await Post.query().where("slug", slug).first()) continue;

      const { data, content } = parseFrontmatter(await Bun.file(join(BLOG_DIR, file)).text());
      const post = new Post();
      post.fill({
        slug,
        title: data["title"] ?? extractTitle(content, slug),
        ...(data["description"] ? { description: data["description"] } : {}),
        body: content,
        // The files carry their own `category:`; anything without one lands in
        // the default rather than being silently uncategorised on the index.
        category: data["category"] ?? POST_CATEGORIES[0],
      });
      // A committed post is already public; an undated one is treated as live
      // too, since it was being served before this table existed.
      //
      // The launch posts share one date and rely on an `order:` tiebreak, with 1
      // leading. Rows sort by `publishedAt` alone, so fold that ordering into the
      // timestamp — a lower `order` publishes later in the day and therefore
      // still leads a newest-first list.
      const order = Number(data["order"]);
      const lead = Number.isFinite(order) ? Math.max(0, 60 - order) : 0;
      post.publishedAt = data["date"]
        ? Carbon.create(`${data["date"]}T00:00:00Z`).addMinutes(lead)
        : Carbon.now();
      post.authorId = author.id;
      await post.save();
    }
  }
}
