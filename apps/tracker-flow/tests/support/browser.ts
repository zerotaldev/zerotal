/**
 * Shared rig for the browser tests.
 *
 * These run against a dev server on the dev database, in real Chrome, because
 * the failures they exist to catch live between the server and the client:
 * `FlowTest` calls actions on an in-process instance, so a component prop never
 * crosses the wire and never comes back as something else. Both bugs these
 * tests pin were invisible to it for exactly that reason.
 */
import { FlowBrowser } from "@zerotal/flow/browser";

export const BASE = "http://localhost:3009";

let proc: ReturnType<typeof Bun.spawn> | null = null;

/** Start a dev server, or reuse one already listening so its log can be read. */
export async function startServer(cwd: string): Promise<void> {
  try {
    if ((await fetch(BASE + "/login")).ok) return;
  } catch {
    /* start our own below */
  }
  // The smoke suite sets ZT_DB_URL=:memory: on this process, and a spawned
  // child inherits it — which boots the server against an empty database with
  // no seeded project, so every browser test fails only when run alongside the
  // rest of the suite. Hand the child a clean env so it uses the dev database
  // the browser is actually meant to be looking at.
  const env = { ...Bun.env } as Record<string, string | undefined>;
  delete env["ZT_DB_URL"];
  delete env["DATABASE_URL"];

  proc = Bun.spawn(["bun", "zt.ts", "serve", "--port=3009"], {
    cwd,
    env: env as Record<string, string>,
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE + "/login")).ok) return;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(500);
  }
  throw new Error("server did not start");
}

export function stopServer(): void {
  proc?.kill();
  proc = null;
}

/** Sign in and land on /projects. Each browser is its own session. */
export async function signIn(page: FlowBrowser, email = "ada@example.com"): Promise<void> {
  await page.fill("#email", email);
  await page.fill("#password", "password");
  // Scoped, for the same reason the edit test is: an unscoped submit selector
  // finds whichever button the layout happens to render first.
  await page.click('form:has(#password) button[type="submit"]');
  await page.waitUntil("location.pathname === '/projects'", "sign-in to land on /projects", 15000);
}

/** Every issue href on the seeded project's list. */
async function issueHrefs(page: FlowBrowser): Promise<string[]> {
  await page.goto(BASE + "/projects/apollo");
  await page.waitUntil(
    "Array.from(document.querySelectorAll('a[href]')).some(function(a){" +
      "var h=a.getAttribute('href')||'';var i=h.lastIndexOf('/issues/');" +
      "return i!==-1 && /^[0-9]+$/.test(h.slice(i+8))})",
    "the issue list to render a row",
    15000,
  );
  return JSON.parse(
    await page.evaluate<string>(
      "JSON.stringify(Array.from(document.querySelectorAll('a[href]')).map(function(a){" +
        "return a.getAttribute('href')||''}).filter(function(h){" +
        "var i=h.lastIndexOf('/issues/');return i!==-1 && /^[0-9]+$/.test(h.slice(i+8))}))",
    ),
  ) as string[];
}

/**
 * Create an issue and return its detail href, leaving the page on it.
 *
 * Each browser test gets its own row rather than "the first issue this user may
 * edit". Two files sharing that one issue is what made them pass alone and fail
 * together — one renamed it while the other was attaching to it, and both
 * reported a timeout at their last step, which reads like a broken feature
 * rather than a broken fixture. Creating it here also makes the author this
 * user, which is what the `canUpdate` controls are gated on.
 */
export async function createIssue(page: FlowBrowser, title: string): Promise<string> {
  await page.goto(BASE + "/projects/apollo/issues/new");
  await page.waitUntil("!!document.querySelector('#title')", "the new-issue form", 15000);

  await page.fill("#title", title);
  // Scoped to the form: the layout's "Sign out" is a submit button too, and it
  // comes first in the document.
  await page.click('form:has(#title) button[type="submit"]');

  await page.waitUntil(
    "(function(){var s=location.pathname.split('/');return s.length===5&&s[1]==='projects'" +
      "&&s[3]==='issues'&&s[4]!==''&&String(Number(s[4]))===s[4]})()",
    "the new issue's detail page",
    20000,
  );
  const href = await page.evaluate<string>("location.pathname");

  // Reloaded rather than left on the page the redirect produced. That arrival is
  // a Flow navigation, and this returns the issue to callers that then drive the
  // dropzone — so a hard load keeps "did the upload bind" separate from "does a
  // client-side navigation re-initialise the file input", which is a different
  // question with its own answer.
  await page.goto(BASE + href);
  return href;
}
