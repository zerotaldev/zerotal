/**
 * The authoring path, end to end: sign in, write a post, publish it, read it
 * back on the public blog.
 *
 * The point of this file is the seam between the three pieces — Flow actions,
 * the database, and the file-backed posts that predate it. A post written here
 * has to appear at /blog with no redeploy, and a draft has to stay invisible.
 *
 * Everything runs inside `inRequest()`. `FlowTest` drives a component's
 * lifecycle but does not open a request scope, and these pages read the session
 * (auth) and the request (pagination) — in production the WebSocket dispatch
 * provides that scope, so the harness needs one too.
 */
import { beforeAll, afterAll, beforeEach, describe, test, expect } from "bun:test";
import { createTestApp, type TestApp } from "@zerotal/testing";
import { FlowTest } from "@zerotal/flow/testing";
import { HttpContext, RequestContext } from "zerotal";
import { Auth, Hash } from "zerotal/auth";
import { Carbon } from "zerotal/carbon";
import { User } from "../app/models/User.ts";
import { Post } from "../app/models/Post.ts";
import { LoginPage } from "../app/admin/LoginPage.tsx";
import { PostsPage } from "../app/admin/PostsPage.tsx";
import { PostEditorPage } from "../app/admin/PostEditorPage.tsx";
import { listPosts, loadPost } from "../app/support/blog.ts";

let app: TestApp;

beforeAll(async () => {
  // Flow snapshot signing and cookie sessions both need a key.
  Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  // In-memory, so the suite never touches the dev content.
  Bun.env.DATABASE_URL = ":memory:";
  app = await createTestApp(() => import("../bootstrap/app.ts").then((m) => m.default));
});

afterAll(() => app.close());

beforeEach(async () => {
  await Post.query().delete();
  await User.query().delete();
  await User.create({
    name: "Author",
    email: "author@zerotal.dev",
    password: await Hash.make("correct-horse"),
  });
});

/** Run `fn` inside a request scope, the way a real Flow frame does. */
function inRequest<T>(fn: () => Promise<T>, url = "http://localhost/admin"): Promise<T> {
  return RequestContext.run(HttpContext.fake(url), fn);
}

/** Sign in the seeded author by driving the login page. */
async function signIn(): Promise<void> {
  const t = await FlowTest.mount(LoginPage);
  await t.set("email", "author@zerotal.dev");
  await t.set("password", "correct-horse");
  await t.call("login");
  t.assertRedirectedTo("/admin");
}

/** Write and publish a post through the editor, returning its slug. */
async function publishPost(title: string, body: string): Promise<void> {
  const editor = await FlowTest.mount(PostEditorPage);
  // The browser patches the whole form object (one `form` key on the wire, not a
  // dotted path per field), so the harness does the same.
  await editor.update("form", { title, body });
  await editor.call("publish");
}

describe("signing in", () => {
  test("a fresh form shows no errors and no signed-in navigation", async () => {
    await inRequest(async () => {
      const t = await FlowTest.mount(LoginPage);

      // `this.errors.<field>` is an always-truthy sentinel for `<ErrorMessage for>`;
      // rendering it directly used to print "[object Object]" under every input.
      t.assertDontSee("[object Object]");
      // The login page wears AdminLayout, which must not offer the desk to a guest.
      t.assertDontSee("Sign out");
      t.assertDontSee("New post");
    });
  });

  test("wrong credentials are refused without saying which half was wrong", async () => {
    await inRequest(async () => {
      const t = await FlowTest.mount(LoginPage);
      await t.set("email", "author@zerotal.dev");
      await t.set("password", "not-the-password");
      await t.call("login");

      t.assertNotRedirected();
      t.assertHasErrors("email", "do not match");
      expect(Auth.check()).toBe(false);
    });
  });

  test("correct credentials sign the author in", async () => {
    await inRequest(async () => {
      await signIn();
      expect(Auth.check()).toBe(true);
      expect(Auth.userOrNull()?.email).toBe("author@zerotal.dev");
    });
  });

  test("the guard keeps anonymous visitors out of the writing desk", async () => {
    const res = await app.get("/admin");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/login");
  });
});

describe("writing a post", () => {
  test("a published post reaches the public blog with no redeploy", async () => {
    await inRequest(async () => {
      await signIn();

      const editor = await FlowTest.mount(PostEditorPage);
      await editor.update("form", {
        title: "Deploying on a Friday",
        body: "# Ship it\n\nThe database is the deploy.",
      });
      await editor.call("publish");

      // The slug came from the title — the editor never asked for one.
      editor.assertRedirectedTo("/admin/posts/deploying-on-a-friday/edit");

      const live = await loadPost("deploying-on-a-friday");
      expect(live?.title).toBe("Deploying on a Friday");
      expect((await listPosts()).map((p) => p.slug)).toContain("deploying-on-a-friday");
    });
  });

  test("the post records who wrote it", async () => {
    await inRequest(async () => {
      await signIn();
      await publishPost("Attributed", "Mine.");

      const post = await Post.query().where("slug", "attributed").firstOrFail();
      expect(post.authorId).toBe(Auth.id());
    });
  });

  test("a draft is saved but stays off the blog", async () => {
    await inRequest(async () => {
      await signIn();

      const editor = await FlowTest.mount(PostEditorPage);
      await editor.update("form", { title: "Half a thought", body: "Not ready." });
      await editor.call("save");

      expect(await Post.query().where("slug", "half-a-thought").first()).not.toBeNull();
      expect(await loadPost("half-a-thought")).toBeNull();
      expect((await listPosts()).map((p) => p.slug)).not.toContain("half-a-thought");
    });
  });

  test("an empty body is refused", async () => {
    await inRequest(async () => {
      await signIn();

      const editor = await FlowTest.mount(PostEditorPage);
      editor.assertDontSee("[object Object]");

      await editor.update("form", { title: "Nothing to say" });
      await editor.call("publish");

      editor.assertHasErrors("body");
      editor.assertDontSee("[object Object]");
      expect(await Post.query().count()).toBe(0);
    });
  });

  test("a colliding slug is suffixed rather than overwriting the post that holds it", async () => {
    await inRequest(async () => {
      await signIn();
      await publishPost("Same Title", "First.");
      await publishPost("Same Title", "Second.");

      const slugs = (await Post.query().orderBy("id").get<Post>()).map((p) => p.slug);
      expect(slugs).toEqual(["same-title", "same-title-2"]);
    });
  });
});

describe("editing an existing post", () => {
  test("@param binds the post by slug, and the editor opens on its content", async () => {
    await inRequest(async () => {
      await signIn();
      await publishPost("Original Title", "Original body.");

      const post = await Post.query().where("slug", "original-title").firstOrFail();
      // What the router does for /admin/posts/original-title/edit: resolve the
      // segment to a model, then hand it to the page.
      const editor = await FlowTest.mount(PostEditorPage, { post });

      expect(editor.page().form.title).toBe("Original Title");
      editor.assertSee("Original body.");
    });
  });

  test("editing updates the post in place rather than creating a second one", async () => {
    await inRequest(async () => {
      await signIn();
      await publishPost("Original Title", "Original body.");

      const post = await Post.query().where("slug", "original-title").firstOrFail();
      const editor = await FlowTest.mount(PostEditorPage, { post });
      await editor.update("form", { body: "Revised body." });
      await editor.call("save");

      expect(await Post.query().count()).toBe(1);
      expect((await loadPost("original-title"))?.content).toBe("Revised body.");
    });
  });

  test("unpublishing pulls a live post off the blog without deleting it", async () => {
    await inRequest(async () => {
      await signIn();
      await publishPost("Temporarily Live", "Up for now.");

      const post = await Post.query().where("slug", "temporarily-live").firstOrFail();
      const editor = await FlowTest.mount(PostEditorPage, { post });
      await editor.call("unpublish");

      expect(await loadPost("temporarily-live")).toBeNull();
      expect(await Post.query().where("slug", "temporarily-live").first()).not.toBeNull();
    });
  });
});

describe("the block editor", () => {
  const BODY = "# Heading\n\nFirst paragraph.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```";

  /** Open the editor on a saved post whose body has three blocks. */
  async function openEditor() {
    await signIn();
    const post = new Post();
    post.fill({ slug: "blocky", title: "Blocky", body: BODY });
    post.publishedAt = Carbon.now().subtractMinutes(1);
    await post.save();
    return FlowTest.mount(PostEditorPage, { post });
  }

  test("renders the article, not a form — each block as published HTML", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      // The heading is real markup, so the page reads as the post it will be.
      expect(editor.html()).toContain("<h1");
      expect(editor.html()).toContain("First paragraph.");
      expect(editor.html()).toContain("<code");
    });
  });

  test("editing one block leaves the others untouched", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      await editor.call("editBlock", 1);
      // A prose block opens as rendered HTML — that is what makes it editable as
      // the article rather than as Markdown source.
      expect(editor.page().draftIsRich).toBe(true);
      expect(editor.page().draft).toContain("First paragraph.");
      expect(editor.page().draft).toContain("<p>");

      // What the contenteditable hands back; commit converts it to Markdown.
      await editor.set("draft", "<p>Rewritten paragraph.</p>");
      await editor.call("commitBlock");

      const body = editor.page().form.body;
      expect(body).toContain("Rewritten paragraph.");
      expect(body).not.toContain("First paragraph.");
      // The heading and the fence are byte-identical either side of the edit.
      expect(body).toContain("# Heading");
      expect(body).toContain("```ts\nconst a = 1;\n\nconst b = 2;\n```");
    });
  });

  test("a fenced code block is one block, blank lines and all", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      // Index 2 is the fence — if the splitter broke on its blank line this
      // would be `const a = 1;` alone.
      await editor.call("editBlock", 2);
      expect(editor.page().draft).toBe("```ts\nconst a = 1;\n\nconst b = 2;\n```");
    });
  });

  test("code opens as plain text, never as rich text", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      await editor.call("editBlock", 2); // the fence
      // The whole point of the split: a contenteditable round trip is what
      // damages a code fence, so this block never takes one.
      expect(editor.page().draftIsRich).toBe(false);

      await editor.call("editBlock", 1); // a paragraph
      expect(editor.page().draftIsRich).toBe(true);
    });
  });

  test("rich formatting is stored as Markdown, not HTML", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      await editor.call("editBlock", 1);
      // What the toolbar's bold/italic/link buttons leave in the editor.
      await editor.set(
        "draft",
        '<p>A <strong>bold</strong> word and a <a href="/docs">link</a>.</p>',
      );
      await editor.call("commitBlock");

      const body = editor.page().form.body;
      expect(body).toContain("A **bold** word and a [link](/docs).");
      expect(body).not.toContain("<strong>");
      expect(body).not.toContain("<a href");
    });
  });

  test("a heading made with the toolbar saves as a Markdown heading", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      await editor.call("editBlock", 1);
      await editor.set("draft", "<h2>Made With The Toolbar</h2>");
      await editor.call("commitBlock");

      expect(editor.page().form.body).toContain("## Made With The Toolbar");
    });
  });

  test("a list made with the toolbar saves as a Markdown list", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      await editor.call("editBlock", 1);
      await editor.set("draft", "<ul><li>one</li><li>two</li></ul>");
      await editor.call("commitBlock");

      expect(editor.page().form.body).toContain("- one\n- two");
    });
  });

  test("emptying a block deletes it — the way a writer deletes a paragraph", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      await editor.call("editBlock", 1);
      await editor.set("draft", "   ");
      await editor.call("commitBlock");

      expect(editor.page().form.body).not.toContain("First paragraph.");
      expect(editor.page().form.body).toContain("# Heading");
    });
  });

  test("a new block is inserted where it was asked for, not appended", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      await editor.call("addBlock", 0); // after the heading
      expect(editor.page().isNew).toBe(true);
      await editor.set("draft", "Inserted second.");
      await editor.call("commitBlock");

      const blocks = editor.page().form.body.split("\n\n");
      expect(blocks[0]).toBe("# Heading");
      expect(blocks[1]).toBe("Inserted second.");
    });
  });

  test("an abandoned new block adds nothing", async () => {
    await inRequest(async () => {
      const editor = await openEditor();
      const before = editor.page().form.body;

      await editor.call("addBlock", 0);
      await editor.call("commitBlock"); // blurred without typing

      expect(editor.page().form.body).toBe(before);
    });
  });

  test("blocks move, and the ends refuse to move past themselves", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      await editor.call("moveBlock", 0, 1);
      expect(editor.page().form.body.startsWith("First paragraph.")).toBe(true);

      const afterMove = editor.page().form.body;
      await editor.call("moveBlock", 0, -1); // already first
      expect(editor.page().form.body).toBe(afterMove);
    });
  });

  test("deleting a block removes only that block", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      await editor.call("deleteBlock", 1);

      expect(editor.page().form.body).not.toContain("First paragraph.");
      expect(editor.page().form.body).toContain("# Heading");
      expect(editor.page().form.body).toContain("const b = 2;");
    });
  });

  test("source mode and block mode agree on the same body", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      await editor.call("toggleSource");
      expect(editor.page().sourceMode).toBe(true);

      // Editing the raw Markdown, as the escape hatch exists for.
      await editor.update("form", { body: "Only one paragraph now." });
      await editor.call("toggleSource");

      // Back in block mode the new body is what renders — blocks are derived,
      // never a second copy that can fall out of step.
      expect(editor.page().form.body).toBe("Only one paragraph now.");
      editor.assertSee("Only one paragraph now.");
    });
  });

  test("Save appears only once there is something to write", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      // Freshly opened: nothing to save, so no button.
      expect(editor.page().isDirty).toBe(false);
      editor.assertSee("Saved");
      editor.assertDontSee(">Save<");

      await editor.call("editBlock", 1);
      // Merely opening a block is not a change.
      expect(editor.page().isDirty).toBe(false);

      await editor.set("draft", "<p>Now it differs.</p>");
      // Typing counts before the block is even committed.
      expect(editor.page().isDirty).toBe(true);

      await editor.call("commitBlock");
      expect(editor.page().isDirty).toBe(true);

      await editor.call("save");
      // Written — the baseline moves and the button steps back out of the way.
      expect(editor.page().isDirty).toBe(false);
      editor.assertSee("Saved");
    });
  });

  test("a metadata edit counts as a change, not just the body", async () => {
    await inRequest(async () => {
      const editor = await openEditor();
      expect(editor.page().isDirty).toBe(false);

      await editor.update("form", { title: "A New Title" });
      expect(editor.page().isDirty).toBe(true);
    });
  });

  test("reordering and deleting count as changes", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      await editor.call("moveBlock", 0, 1);
      expect(editor.page().isDirty).toBe(true);

      await editor.call("save");
      expect(editor.page().isDirty).toBe(false);

      await editor.call("deleteBlock", 0);
      expect(editor.page().isDirty).toBe(true);
    });
  });

  test("an empty new post has nothing to save", async () => {
    await inRequest(async () => {
      await signIn();
      const editor = await FlowTest.mount(PostEditorPage);

      expect(editor.page().isDirty).toBe(false);

      await editor.update("form", { title: "Something" });
      expect(editor.page().isDirty).toBe(true);
    });
  });

  test("saving folds in a block still open, so Save needs no click-away first", async () => {
    await inRequest(async () => {
      const editor = await openEditor();

      await editor.call("editBlock", 1);
      await editor.set("draft", "Saved while still editing.");
      await editor.call("save");

      const reloaded = await Post.query().where("slug", "blocky").firstOrFail();
      expect(reloaded.body).toContain("Saved while still editing.");
    });
  });

  test("a brand-new post opens with an editor already waiting", async () => {
    await inRequest(async () => {
      await signIn();
      const editor = await FlowTest.mount(PostEditorPage);

      expect(editor.page().editing).toBe(0);
      expect(editor.page().isNew).toBe(true);
    });
  });
});

describe("the post list", () => {
  /** 12 posts, so a 10-per-page list has a second page. */
  async function seedPosts(prefix: string): Promise<void> {
    for (let i = 1; i <= 12; i++) {
      const post = new Post();
      post.fill({ slug: `${prefix}-${i}`, title: `${prefix} ${i}`, body: "…" });
      await post.save();
    }
  }

  test("paginates on the component's own page, not a stale query string", async () => {
    await inRequest(async () => {
      await signIn();
      await seedPosts("post");

      const list = await FlowTest.mount(PostsPage);
      list.assertSee("12 posts");

      // Page 2 of 10-per-page holds the remaining 2. The mixin's resolver is what
      // makes paginate() inside render() return this page.
      await list.call("gotoPage", 2);
      expect(list.page().page).toBe(2);
      expect(list.html().match(/href="\/admin\/posts\/post-\d+\/edit"/g)?.length).toBe(2);
    });
  });

  test("searching resets to page 1, so the author is never left past the end", async () => {
    await inRequest(async () => {
      await signIn();
      await seedPosts("note");

      const list = await FlowTest.mount(PostsPage);
      await list.call("gotoPage", 2);
      await list.update("search", "Note 1");

      expect(list.page().page).toBe(1);
    });
  });
});

describe("the public blog index", () => {
  /**
   * Publish a post directly, skipping the editor. Dated a minute back on
   * purpose: visibility is `publishedAt <= now`, so stamping exactly `now` races
   * the query that reads it and can leave the post invisible by a millisecond.
   */
  async function publish(slug: string, title: string, category?: string): Promise<void> {
    const post = new Post();
    post.fill({ slug, title, body: "…", ...(category ? { category } : {}) });
    post.publishedAt = Carbon.now().subtractMinutes(1);
    await post.save();
  }

  test("cards carry their category, and the filter bar lists the ones in use", async () => {
    await publish("a-release", "A Release", "Announcements");
    await publish("a-deep-dive", "A Deep Dive", "Flow");

    const html = await (await app.get("/blog")).text();

    expect(html).toContain("A Release");
    expect(html).toContain("A Deep Dive");
    // Pills for the two categories actually in use…
    expect(html).toContain('href="/blog?category=Announcements"');
    expect(html).toContain('href="/blog?category=Flow"');
    // …and none for a category no post uses.
    expect(html).not.toContain('href="/blog?category=Guides"');
  });

  test("?category= narrows the grid to that category", async () => {
    await publish("a-release", "A Release", "Announcements");
    await publish("a-deep-dive", "A Deep Dive", "Flow");

    const html = await (await app.get("/blog?category=Flow")).text();

    expect(html).toContain("A Deep Dive");
    expect(html).not.toContain("A Release");
  });

  test("an unknown category falls back to the full list rather than an empty page", async () => {
    await publish("a-release", "A Release", "Announcements");

    const res = await app.get("/blog?category=Nonsense");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("A Release");
  });

  test("posts published the same day lead in publishedAt order, newest first", async () => {
    const at = async (slug: string, title: string, minutes: number) => {
      const post = new Post();
      post.fill({ slug, title, body: "…" });
      post.publishedAt = Carbon.create("2026-07-31T00:00:00Z").addMinutes(minutes);
      await post.save();
    };
    // Written out of order on purpose; the later timestamp must still lead.
    await at("second", "Second Post", 10);
    await at("first", "First Post", 20);

    const slugs = (await listPosts()).map((p) => p.slug);
    expect(slugs.indexOf("first")).toBeLessThan(slugs.indexOf("second"));
  });

  test("?sort= reorders the list, and an unknown sort falls back to newest", async () => {
    await publish("zebra", "Zebra Post", "Flow");
    await publish("apple", "Apple Post", "Flow");

    const titlesOf = (html: string) =>
      [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]!.trim());

    const az = titlesOf(await (await app.get("/blog?sort=az")).text());
    expect(az.indexOf("Apple Post")).toBeLessThan(az.indexOf("Zebra Post"));

    const za = titlesOf(await (await app.get("/blog?sort=za")).text());
    expect(za.indexOf("Zebra Post")).toBeLessThan(za.indexOf("Apple Post"));

    // Oldest is the reverse of the default order.
    const newest = titlesOf(await (await app.get("/blog")).text());
    const oldest = titlesOf(await (await app.get("/blog?sort=oldest")).text());
    expect(oldest).toEqual([...newest].reverse());

    // A stale or hand-typed sort should still render the blog.
    expect(titlesOf(await (await app.get("/blog?sort=sideways")).text())).toEqual(newest);
  });

  test("?view=list swaps the grid for rows", async () => {
    await publish("a-release", "A Release", "Announcements");

    const grid = await (await app.get("/blog")).text();
    const list = await (await app.get("/blog?view=list")).text();

    expect(grid).toContain("lg:grid-cols-3");
    expect(list).not.toContain("lg:grid-cols-3");
    // Both views list the post; only the shape differs.
    expect(list).toContain("A Release");
  });

  test("each control preserves the others, so state survives a click", async () => {
    await publish("a-deep-dive", "A Deep Dive", "Flow");

    const html = await (await app.get("/blog?category=Flow&sort=az&view=list")).text();

    // Switching sort keeps the category and the view…
    expect(html).toContain("/blog?category=Flow&amp;sort=za&amp;view=list");
    // …switching view keeps the category and the sort…
    expect(html).toContain("/blog?category=Flow&amp;sort=az");
    // …and clearing the category keeps sort and view.
    expect(html).toContain('href="/blog?sort=az&amp;view=list"');
  });

  test("defaults stay off the URL, so the canonical listing is a bare /blog", async () => {
    await publish("a-release", "A Release", "Announcements");

    const html = await (await app.get("/blog?sort=az")).text();
    // Returning to newest+grid drops the params rather than spelling them out.
    expect(html).toContain('href="/blog"');
  });

  test("a post with no category still renders", async () => {
    await publish("uncategorised", "Uncategorised Post");

    const html = await (await app.get("/blog")).text();
    expect(html).toContain("Uncategorised Post");
  });
});

describe("crawler and feed endpoints", () => {
  test("robots.txt points at the sitemap and keeps crawlers out of /admin", async () => {
    const res = await app.get("/robots.txt");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(body).toContain("Disallow: /admin");
    expect(body).toMatch(/Sitemap: https?:\/\/\S+\/sitemap\.xml/);
  });

  test("the sitemap lists docs and posts, and omits the listing's query views", async () => {
    const post = new Post();
    post.fill({ slug: "sitemapped", title: "Sitemapped", body: "…" });
    post.publishedAt = Carbon.now().subtractMinutes(1);
    await post.save();

    const body = await (await app.get("/sitemap.xml")).text();

    expect(body).toContain("<loc>");
    expect(body).toContain("/blog/sitemapped");
    expect(body).toContain("/docs/routing");
    // Every `?category=`/`?sort=`/`?view=` arrangement canonicalises to /blog;
    // listing them would be asking to be indexed as duplicates.
    expect(body).not.toContain("category=");
    expect(body).not.toContain("sort=");
    // TypeDoc output is thousands of pages and regenerated per build.
    expect(body).not.toContain("/docs/api/");
  });

  test("the feed carries published posts with stable per-post identity", async () => {
    const post = new Post();
    post.fill({
      slug: "feed-item",
      title: "Feed Item",
      description: "A summary.",
      body: "…",
      category: "Flow",
    });
    post.publishedAt = Carbon.now().subtractMinutes(1);
    await post.save();

    const res = await app.get("/blog/feed.xml");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("xml");
    expect(body).toContain("<title>Feed Item</title>");
    expect(body).toContain("A summary.");
    expect(body).toContain("<category>Flow</category>");
    // The guid is the permalink, so editing a title does not resurface the post.
    expect(body).toContain('<guid isPermaLink="true">');
  });

  test("the feed route wins over the /blog/* post wildcard", async () => {
    // `/blog/feed.xml` would otherwise be read as a post slug and 404.
    expect((await app.get("/blog/feed.xml")).status).toBe(200);
    // …while a real post keeps working.
    expect((await app.get("/blog/introducing-zerotal")).status).toBe(200);
  });

  test("blog listing views all point at one canonical URL", async () => {
    const canonicalOf = (html: string) => html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];

    const plain = canonicalOf(await (await app.get("/blog")).text());
    const filtered = canonicalOf(await (await app.get("/blog?category=Flow")).text());
    const sorted = canonicalOf(await (await app.get("/blog?sort=az&view=list")).text());

    expect(plain).toMatch(/\/blog$/);
    expect(filtered).toBe(plain);
    expect(sorted).toBe(plain);
  });
});

describe("posts committed as files", () => {
  test("still render when no row shadows them", async () => {
    // blog/*.md ships in the repo; with an empty table the index is still served
    // from those files, which keeps a fresh checkout from looking broken.
    await inRequest(async () => {
      expect((await listPosts()).map((p) => p.slug)).toContain("introducing-zerotal");
    });
  });

  test("a row of the same slug takes over, which is what makes them editable", async () => {
    await inRequest(async () => {
      const post = new Post();
      post.fill({
        slug: "introducing-zerotal",
        title: "Rewritten In The Browser",
        body: "Edited without a redeploy.",
      });
      post.publishedAt = Carbon.now().subtractMinutes(1);
      await post.save();

      expect((await loadPost("introducing-zerotal"))?.title).toBe("Rewritten In The Browser");
    });
  });
});
