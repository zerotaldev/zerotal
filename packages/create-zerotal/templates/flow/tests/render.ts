/**
 * Build one page the way a visit does, and rethrow anything that goes wrong on the way.
 *
 * `@zerotal/inertia/testing`'s `renderPage()` builds a React page; a Flow page is a
 * class on the server, so this one requests it with `FlowTest`: through its route's
 * middleware and handler, as `user`, at `url`, in its layout. The page loads its data in
 * `onMount()`, as it does for a real visit; `state` is laid over the top afterwards, to show
 * a page in a state that would take several requests to reach (two-factor half set up, say).
 *
 * It returns the page parsed, to read the way the HTTP tests read a response: `res.html()`
 * there, this here.
 */
import { parseHtml, type HtmlDocument } from "zerotal/testing";
import { FlowTest } from "@zerotal/flow/testing";
import type { Page } from "../app/flow/lib/page";
import type { User } from "../app/models/User";

// FlowTest's own signature, for a page this kit wrote: any of app/flow/pages/.
type PageClass<T extends Page> = Parameters<typeof FlowTest.mount<T>>[0];

export async function renderPage<T extends Page>(
  PageClass: PageClass<T>,
  {
    user = null,
    url = "/",
    state = {},
    session,
  }: {
    user?: User | null;
    url?: string;
    state?: Partial<T>;
    /** What the session holds before the visit: a password just confirmed, say. */
    session?: Record<string, unknown>;
  } = {},
): Promise<HtmlDocument> {
  const t = await FlowTest.actingAs(user).mount(
    PageClass,
    {},
    { url, ...(session ? { session } : {}) },
  );
  const document = t.document();
  if (Object.keys(state).length === 0) return parseHtml(document);

  // These pages are static, so the state goes on the instance the visit built, which
  // renders again with it; the new markup takes the old one's place in the document.
  const first = t.html();
  for (const [key, value] of Object.entries(state)) await t.seed(key as keyof T, value);
  await t.render();
  return parseHtml(document.replace(first, t.html()));
}
