/**
 * The app boots, serves every page, and its actions do what they claim.
 *
 * This suite exists because a Flow page fails quietly. A component whose
 * `render()` throws, whose route never registered, or whose action was never
 * `@expose`d produces a page that looks broken only when somebody opens it —
 * there is no compile step that catches any of the three. Each `get` below is
 * therefore an assertion that one page mounts, queries and renders end to end.
 *
 * `actingAs` rather than a sign-in POST: signing in here is a socket action, and
 * the test client keeps no cookie jar between requests.
 */
import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { createTestApp, migrateDatabase, type TestApp } from "zerotal/testing";
import { RequestContext, HttpContext } from "@zerotal/core";
import { Hash } from "zerotal/auth";
import { FlowTest } from "@zerotal/flow/testing";
import { User } from "@app/models/User.ts";
import { Project } from "@app/models/Project.ts";
import { Issue } from "@app/models/Issue.ts";
import { Comment } from "@app/models/Comment.ts";
import { Attachment } from "@app/models/Attachment.ts";
import { LoginPage } from "../app/flow/pages/login.tsx";
import { IssueDetailPage } from "../app/flow/pages/projects/[project]/issues/[issue]/index.tsx";
import { NewIssuePage } from "../app/flow/pages/projects/[project]/issues/new.tsx";
import { BoardPage } from "../app/flow/pages/projects/[project]/board.tsx";
import { ProjectIssuesPage } from "../app/flow/pages/projects/[project]/index.tsx";
import { ProjectsPage } from "../app/flow/pages/projects/index.tsx";

let app: TestApp;
let author: User;
let other: User;
let project: Project;
let issue: Issue;

beforeAll(async () => {
  Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  Bun.env.ZT_DB_URL ??= ":memory:";
  app = await createTestApp(() => import("../bootstrap/app.ts").then((m) => m.default));
  await migrateDatabase();

  const password = await Hash.make("correct-horse-battery");
  author = await User.forceCreate({
    name: "Grace Hopper",
    email: "grace@example.com",
    password,
    role: "user",
  });
  other = await User.forceCreate({
    name: "Ada Lovelace",
    email: "ada@example.com",
    password,
    role: "user",
  });

  project = await Project.forceCreate({
    name: "Apollo",
    slug: "apollo",
    description: "The one with the issues.",
    ownerId: author.id,
  });

  issue = await Issue.forceCreate({
    projectId: project.id,
    authorId: author.id,
    assigneeId: null,
    title: "The telemetry drops on reconnect",
    body: "Steps to reproduce are in the log.",
    status: "todo",
    priority: "high",
    position: 0,
  });
});

afterAll(() => app.close());

/**
 * Run a `FlowTest` interaction inside a request scope, signed in as `user`.
 *
 * `FlowTest` drives the full server-side pipeline but opens **no request
 * context**: there is no `RequestContext.run` anywhere in it, so `Auth.user()`
 * throws `E_UNAUTHORIZED` and `Auth.attempt()` throws
 * `E_CONTEXT_OUTSIDE_REQUEST`. Every authenticated Flow action reads one or the
 * other, which means the component-level harness cannot, as shipped, test any
 * action on a page behind a sign-in — the majority of them.
 *
 * `app.actingAs()` does not help: it encodes a session cookie for `app.get()`,
 * and `FlowTest` never makes a request to send it on.
 *
 * So the scope is opened here, the same way `packages/flow/src/pagination-
 * resolver.test.ts` does it. `FlowTest` growing an `actingAs` of its own would
 * delete this helper.
 */
function asUser<T>(user: User | null, fn: () => Promise<T>): Promise<T> {
  // `HttpContext.fake()` rather than an object literal cast to the type: it
  // carries a real `Request`, which matters because saving an audited model
  // reaches for `ctx.request.headers` to record the actor's IP. A hand-rolled
  // stub passes the type check and then dies inside the audit observer.
  const ctx = HttpContext.fake("http://localhost/");
  if (user) ctx.user = user;

  return RequestContext.run(ctx, fn);
}

/**
 * How many issue rows the list rendered.
 *
 * Counted off the row-number cell rather than `<li>`, because the page has other
 * lists on it (the filter selects' options) and a `<li>` count would quietly
 * track those too.
 */
function countRows(html: string): number {
  return html.split("w-11 shrink-0 pt-0.5").length - 1;
}

/** How many project cards the grid rendered — counted off each card's link. */
function countCards(html: string): number {
  return html.split('class="flex h-full flex-col rounded-xl').length - 1;
}

describe("public pages", () => {
  test("serves the home page to a guest", async () => {
    const res = await app.get("/");
    res.assertOk();
    expect(res.text()).toContain("Everything in one TypeScript app");
  });

  test("serves the guest screens", async () => {
    (await app.get("/login")).assertOk();
    (await app.get("/register")).assertOk();
    (await app.get("/forgot-password")).assertOk();
  });

  test("returns 404 for an unregistered path", async () => {
    (await app.get("/definitely-not-a-route")).assertNotFound();
  });
});

describe("the auth wall", () => {
  test("keeps every signed-in page behind a sign-in", async () => {
    app.actingAsGuest();
    for (const path of [
      "/dashboard",
      "/activity",
      "/projects",
      "/profile",
      "/projects/apollo",
      "/projects/apollo/board",
      "/projects/apollo/issues/new",
    ]) {
      (await app.get(path)).assertRedirect("/login");
    }
  });
});

/**
 * Every page, mounted and rendered.
 *
 * The assertions are on content the page can only produce by having actually
 * queried — a project name, an issue title, a status word — rather than on a 200,
 * because a Flow page that renders an empty shell also returns 200.
 */
describe("the signed-in pages", () => {
  test("dashboard counts what is there", async () => {
    app.actingAs({ id: author.id });
    const res = await app.get("/dashboard");
    res.assertOk();
    expect(res.text()).toContain("Dashboard");
    expect(res.text()).toContain("Apollo");
  });

  test("activity renders the trail", async () => {
    app.actingAs({ id: author.id });
    (await app.get("/activity")).assertOk();
  });

  test("projects index lists the project and its issue count", async () => {
    app.actingAs({ id: author.id });
    const res = await app.get("/projects");
    res.assertOk();
    expect(res.text()).toContain("Apollo");
    expect(res.text()).toContain("The one with the issues.");
  });

  test("the issue list renders the issue", async () => {
    app.actingAs({ id: author.id });
    const res = await app.get("/projects/apollo");
    res.assertOk();
    expect(res.text()).toContain("The telemetry drops on reconnect");
  });

  test("the issue detail renders the issue and its thread", async () => {
    app.actingAs({ id: author.id });
    const res = await app.get(`/projects/apollo/issues/${issue.id}`);
    res.assertOk();
    expect(res.text()).toContain("The telemetry drops on reconnect");
    expect(res.text()).toContain("Steps to reproduce are in the log.");
  });

  test("the new-issue form renders its fields", async () => {
    app.actingAs({ id: author.id });
    const res = await app.get("/projects/apollo/issues/new");
    res.assertOk();
    expect(res.text()).toContain("New issue");
  });

  test("the edit form renders for the author", async () => {
    app.actingAs({ id: author.id });
    const res = await app.get(`/projects/apollo/issues/${issue.id}/edit`);
    res.assertOk();
    expect(res.text()).toContain("The telemetry drops on reconnect");
  });

  test("the edit form is refused to anyone else — feature 5", async () => {
    app.actingAs({ id: other.id });
    const res = await app.get(`/projects/apollo/issues/${issue.id}/edit`);
    expect(res.status).toBe(403);
  });

  test("the board renders its columns", async () => {
    app.actingAs({ id: author.id });
    const res = await app.get("/projects/apollo/board");
    res.assertOk();
    expect(res.text()).toContain("Board");
    expect(res.text()).toContain("The telemetry drops on reconnect");
  });

  test("the profile renders the tab strip and the first panel", async () => {
    app.actingAs({ id: author.id });
    const res = await app.get("/profile");
    res.assertOk();
    expect(res.text()).toContain('role="tablist"');
    expect(res.text()).toContain("Personal information");
  });

  test("the profile opens the section named in the URL", async () => {
    app.actingAs({ id: author.id });
    const res = await app.get("/profile?section=security");
    res.assertOk();
    // The panel the URL asked for, not the first one — the thing `<Tabs>` cannot do.
    expect(res.text()).toContain("Choose a strong password for your account.");
    expect(res.text()).not.toContain("Update your name and email address.");
  });
});

/**
 * The drag-and-drop wiring, asserted on the emitted attributes.
 *
 * The board's whole mechanism is that the client reads a method name off the
 * container it dropped into. If `onSort` ever stops emitting `flow:sort`, or
 * emits a client expression instead of the name, dragging silently stops working
 * and every other test here still passes.
 */
describe("the board's sort wiring", () => {
  test("each column carries its own drop action and shares one group", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(BoardPage, { project });

      expect(t.html()).toContain('flow:sort="dropInBacklog"');
    expect(t.html()).toContain('flow:sort="dropInTodo"');
    expect(t.html()).toContain('flow:sort="dropInProgress"');
      expect(t.html()).toContain('flow:sort:group="issues"');
      expect(t.html()).toContain(`flow:sort:item="${issue.id}"`);
    });
  });

  test("a drop moves the card and writes the destination column", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(BoardPage, { project });
      await t.call("dropInDone", String(issue.id), 0);
    });

    const moved = await Issue.findOrFail(issue.id);
    expect(moved.status).toBe("done");
    expect(moved.position).toBe(0);
  });

  test("a drop is refused for someone who may not update the issue", async () => {
    await asUser(other, async () => {
      const t = await FlowTest.mount(BoardPage, { project });
      await t.call("dropInCancelled", String(issue.id), 0);
    });

    const unmoved = await Issue.findOrFail(issue.id);
    expect(unmoved.status).not.toBe("cancelled");
  });
});

/**
 * The comment thread, driven as the browser drives it.
 *
 * `postComment` is the action the socket calls, so calling it here covers the
 * shared-rule wiring: the validation comes from `StoreCommentRequest.rules()`,
 * which is the same object the other two builds POST against.
 */
describe("comments", () => {
  test("posting appends to the thread without a reload", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(IssueDetailPage, { project, issue });

      expect(t.page().comments.length).toBe(0);

      await t.set("body", "Reproduced on a flaky connection.");
      await t.call("postComment");

      expect(t.page().comments.length).toBe(1);
      expect(t.page().body).toBe("");
      t.assertSee("Reproduced on a flaky connection.");
    });

    expect(await Comment.query().where("issue_id", issue.id).count()).toBe(1);
  });

  test("the page subscribes to this issue's channel, not a shared one", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(IssueDetailPage, { project, issue });

      // The resolved channel, with the real id in it. A regression here is
      // invisible in the browser — an unresolved or over-broad channel produces
      // no error, just a thread that never updates or one that receives other
      // people's issues.
      expect(t.snapshot()?.memo?.listeners).toEqual({
        [`echo-private:issues.${issue.id},CommentPosted`]: "onCommentPosted",
      });
    });
  });

  test("a broadcast from elsewhere appends to the open thread", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(IssueDetailPage, { project, issue });
      const before = t.page().comments.length;

      await t.call("onCommentPosted", {
        comment: { id: 9999, body: "From another window.", author: { name: "Ada" }, createdAt: null },
      });

      expect(t.page().comments.length).toBe(before + 1);
      t.assertSee("From another window.");

      // Delivered twice — a reconnect replay — must not double up.
      await t.call("onCommentPosted", {
        comment: { id: 9999, body: "From another window.", author: { name: "Ada" }, createdAt: null },
      });
      expect(t.page().comments.length).toBe(before + 1);
    });
  });

  test("an empty comment is refused by the shared rule", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(IssueDetailPage, { project, issue });

      await t.set("body", "   ");
      await t.call("postComment");

      t.assertHasErrors("body");
    });
  });
});

/**
 * Attaching a file, over the two hops it actually takes.
 *
 * The bytes never touch the socket: the browser POSTs them to `/__flow/upload`
 * and gets back a signed reference, which it `$set`s onto the bound property;
 * only then does an action store it. Both halves are exercised here because a
 * break in either looks identical from the page — nothing happens.
 */
describe("attachments", () => {
  test("uploading returns a signed reference the component can bind", async () => {
    app.actingAs({ id: author.id });

    const res = await app.multipart("/__flow/upload", {
      file: { content: "screenshot bytes", filename: "trace.txt", type: "text/plain" },
    });

    res.assertOk();
    const ref = res.json() as Record<string, unknown>;
    // A reference, not the bytes: the path is server-generated and the original
    // name is carried as data, never used as a path.
    expect(ref["originalName"]).toBe("trace.txt");
    expect(String(ref["tmpPath"])).toStartWith("flow-tmp/");
    expect(ref["tmpPath"]).not.toContain("trace.txt");
  });

  test("a bound reference is stored and shows up on the issue", async () => {
    app.actingAs({ id: author.id });
    const upload = await app.multipart("/__flow/upload", {
      file: { content: "screenshot bytes", filename: "trace.txt", type: "text/plain" },
    });
    upload.assertOk();
    const ref = upload.json();

    await asUser(author, async () => {
      const t = await FlowTest.mount(IssueDetailPage, { project, issue });
      expect(t.page().attachments.length).toBe(0);

      // What the browser does once the POST resolves.
      await t.update("file", ref);

      // The reference bound, so the page offers to attach it. Before the
      // `flow:upload-finish` fix this was the only way to tell the upload had
      // worked at all — the dropzone still read "Uploading… 100%".
      t.assertSee("Attach");

      await t.call("attachFile");

      expect(t.page().attachments.length).toBe(1);
      expect(t.page().attachments[0]?.originalName).toBe("trace.txt");
      t.assertSee("trace.txt");
    });

    expect(await Attachment.query().where("issue_id", issue.id).count()).toBe(1);
  });

  test("refuses a file type the shared rule does not accept", async () => {
    app.actingAs({ id: author.id });
    const upload = await app.multipart("/__flow/upload", {
      file: { content: "MZ", filename: "payload.exe", type: "application/octet-stream" },
    });
    upload.assertOk();
    const ref = upload.json();

    await asUser(author, async () => {
      const t = await FlowTest.mount(IssueDetailPage, { project, issue });
      const before = t.page().attachments.length;

      await t.update("file", ref);
      await t.call("attachFile");

      // The dropzone's `accept` is a courtesy that filters the picker; the check
      // that matters runs in the action, because a socket frame can carry a
      // reference to anything.
      expect(t.page().attachments.length).toBe(before);
      expect(t.page().uploadError).toBeTruthy();
    });
  });
});

/** The issue form, validated against the rules the other two builds share. */
describe("creating an issue", () => {
  test("a valid form creates the issue and redirects to it", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(NewIssuePage, { project });

      await t.set("title_", "The worker never boots");
      await t.set("body", "It exits before the queue connects.");
      await t.set("status", "backlog");
      await t.set("priority", "urgent");
      await t.call("create");

      const created = await Issue.query().where("title", "The worker never boots").firstOrFail();
      expect(created.projectId).toBe(project.id);
      expect(created.authorId).toBe(author.id);
      t.assertRedirectedTo(`/projects/apollo/issues/${created.id}`);
    });
  });

  test("a title under three characters is refused — StoreIssueRequest's rule", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(NewIssuePage, { project });

      await t.set("title_", "no");
      await t.call("create");

      t.assertHasErrors("title_");
    });
  });

  test("an unselected assignee normalises to null rather than failing", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(NewIssuePage, { project });

      await t.set("title_", "Assignee left blank on purpose");
      await t.set("assigneeId", "");
      await t.call("create");
    });

    const created = await Issue.query()
      .where("title", "Assignee left blank on purpose")
      .firstOrFail();
    expect(created.assigneeId ?? null).toBeNull();
  });
});

/** The filters, driven as the live-bound inputs drive them. */
describe("the issue list filters", () => {
  test("a search narrows the list and a non-match empties it", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(ProjectIssuesPage, { project });

      await t.set("q", "telemetry");
      t.assertSee("The telemetry drops on reconnect");

      await t.set("q", "nothing matches this");
      t.assertDontSee("The telemetry drops on reconnect");
      t.assertSee("No issues match these filters");
    });
  });

  test("an unrecognised status is dropped rather than queried", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(ProjectIssuesPage, { project, status: "nonsense" });

      // The whole project, not an empty list: the value narrowed to null.
      t.assertSee("The telemetry drops on reconnect");
    });
  });

  test("changing a filter resets the page", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(ProjectIssuesPage, { project, depth: 3 });

      await t.update("q", "telemetry");
      expect(t.page().depth).toBe(1);
    });
  });
});

/**
 * Infinite scroll on the issue list.
 *
 * `page` counts how many pages are *loaded*, not which one is shown, so the
 * assertions are about depth: does the list grow, does the URL still describe
 * what you can see, and does changing a filter take it back to the top rather
 * than leaving stale rows underneath.
 */
describe("the issue list grows by scrolling", () => {
  let big: Project;

  beforeAll(async () => {
    big = await Project.forceCreate({
      name: "Gemini",
      slug: "gemini",
      description: "Enough issues to scroll.",
      ownerId: author.id,
    });

    // 25 issues → three pages at PER_PAGE = 10.
    for (let i = 1; i <= 25; i++) {
      await Issue.forceCreate({
        projectId: big.id,
        authorId: author.id,
        title: `Gemini issue ${String(i).padStart(2, "0")}`,
        body: "",
        status: i % 2 === 0 ? "todo" : "backlog",
        priority: "medium",
        position: i,
      });
    }
  });

  test("numbers the rows by position, not by id", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(ProjectIssuesPage, { project: big });
      const cells = [...t.html().matchAll(/tabular-nums">\s*(\d+)\s*</g)].map((m) => m[1]);

      // 1..10 down the page. The ids are in the 100s by now, so this also
      // catches the column silently reverting to the primary key.
      expect(cells.slice(0, 10)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    });
  });

  test("the numbering follows the sort rather than the row", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(ProjectIssuesPage, { project: big });
      const first = /w-11 shrink-0 pt-0\.5[^>]*>\s*1\s*<[\s\S]*?font-medium text-foreground">([^<]+)</;

      const newestFirst = first.exec(t.html())?.[1];
      await t.update("sort", "oldest");
      const oldestFirst = first.exec(t.html())?.[1];

      // Row 1 is a different issue under a different sort — that is what makes
      // this a position and not an identifier.
      expect(newestFirst).toBeDefined();
      expect(oldestFirst).toBeDefined();
      expect(oldestFirst).not.toBe(newestFirst);
    });
  });

  test("starts at one page deep and offers more", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(ProjectIssuesPage, { project: big });

      expect(countRows(t.html())).toBe(10);
      t.assertSee("Showing 10 of 25");
      // The sentinel is present, carries the action the observer calls, and
      // fires ahead of the viewport rather than at it.
      expect(t.html()).toContain('flow:intersect="loadMore"');
      expect(t.html()).toContain('flow:intersect.margin="300px"');
      t.assertSee("Load more");
    });
  });

  test("loadMore deepens the list without losing what was there", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(ProjectIssuesPage, { project: big });
      const first = "Gemini issue 25"; // newest first — the top row

      t.assertSee(first);
      await t.call("loadMore");

      expect(countRows(t.html())).toBe(20);
      t.assertSee("Showing 20 of 25");
      // Appended, not replaced: the first page is still rendered above.
      t.assertSee(first);
    });
  });

  test("mounting deeper renders everything above it too", async () => {
    await asUser(author, async () => {
      // Depth 3 means three pages' worth from the top, not the third slice.
      const t = await FlowTest.mount(ProjectIssuesPage, { project: big, depth: 3 });

      expect(countRows(t.html())).toBe(25);
      t.assertSee("Gemini issue 25");
      t.assertSee("Gemini issue 01");
    });
  });

  test("stops offering more at the end", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(ProjectIssuesPage, { project: big, depth: 3 });

      t.assertSee("Showing 25 of 25");
      // `show={false}` renders nothing at all, so the observer has no sentinel
      // left to fire against.
      expect(t.html()).not.toContain("flow:intersect");
      t.assertDontSee("Load more");
    });
  });

  test("overshooting the end clamps rather than erroring", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(ProjectIssuesPage, { project: big, depth: 3 });

      // The observer and the button can both fire; depth past the end is fine.
      await t.call("loadMore");
      await t.call("loadMore");

      expect(countRows(t.html())).toBe(25);
      t.assertSee("Showing 25 of 25");
    });
  });

  test("changing a filter goes back to the top, with no stale rows below", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(ProjectIssuesPage, { project: big, depth: 3 });
      expect(countRows(t.html())).toBe(25);

      await t.update("status", "todo");

      // Depth reset, and the list is only the filtered rows — the failure this
      // guards is a deep list keeping its old rows underneath the new ones.
      expect(t.page().depth).toBe(1);
      expect(countRows(t.html())).toBe(10);
      t.assertSee("Showing 10 of 12");
    });
  });
});

/**
 * The projects grid grows the same way.
 *
 * Worth its own cover rather than trusting the issue list's: it is a different
 * page with its own query, and the failure it guards against is the one that was
 * actually there — a hundred projects rendering a hundred cards on first paint.
 */
describe("the projects grid grows by scrolling", () => {
  beforeAll(async () => {
    // 30 more, so the grid spills past PER_PAGE = 24 with the seeded three.
    for (let i = 1; i <= 30; i++) {
      await Project.forceCreate({
        name: `Scroll ${String(i).padStart(2, "0")}`,
        slug: `scroll-${i}`,
        description: "One of many.",
        ownerId: author.id,
      });
    }
  });

  test("renders one page of cards, not everything", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(ProjectsPage);

      expect(countCards(t.html())).toBe(24);
      expect(t.html()).toContain('flow:intersect="loadMore"');
      t.assertSee("Load more");
    });
  });

  test("loadMore deepens the grid", async () => {
    await asUser(author, async () => {
      const t = await FlowTest.mount(ProjectsPage);
      await t.call("loadMore");

      // 33 projects exist by now: Apollo, Gemini, the big one, and 30 more.
      const total = await Project.query().count();
      expect(countCards(t.html())).toBe(total);
      t.assertSee(`Showing ${total} of ${total}`);
      // At the end the sentinel is gone, so nothing keeps firing.
      expect(t.html()).not.toContain("flow:intersect");
    });
  });

  test("depth deepens the grid here too", async () => {
    await asUser(author, async () => {
      const shallow = await FlowTest.mount(ProjectsPage, { depth: 1 });
      const deep = await FlowTest.mount(ProjectsPage, { depth: 2 });

      expect(countCards(deep.html())).toBeGreaterThan(countCards(shallow.html()));
    });
  });
});

/** Sign-in, the one action every other page depends on. */
describe("signing in", () => {
  test("valid credentials land on the projects page", async () => {
    await asUser(null, async () => {
      const t = await FlowTest.mount(LoginPage);

      await t.set("email", "grace@example.com");
      await t.set("password", "correct-horse-battery");
      await t.call("login");

      t.assertRedirectedTo("/projects");
    });
  });

  test("a wrong password says nothing about which half was wrong", async () => {
    await asUser(null, async () => {
      const t = await FlowTest.mount(LoginPage);

      await t.set("email", "grace@example.com");
      await t.set("password", "not-the-password");
      await t.call("login");

      t.assertNotRedirected();
      expect(t.page().error).toContain("do not match");
    });
  });
});
