/**
 * Build one page the way its route does — the page through Flow's own render, then the
 * layout around it — and rethrow anything that goes wrong on the way.
 *
 * `@zerotal/inertia/testing`'s `renderPage()` builds a React page; a Flow page is a
 * class on the server, so this one drives it with `FlowTest`, inside a request of its own
 * so the page can read the signed-in user. The page loads its data in `onMount()`, as it
 * does for a real visit; `state` is laid over the top afterwards, to show a page in a
 * state that would take several requests to reach (two-factor half set up, say).
 */
import { HttpContext, RequestContext } from "zerotal";
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
  }: { user?: User | null; url?: string; state?: Partial<T> } = {},
): Promise<string> {
  const http = HttpContext.fake(`http://localhost${url}`);
  if (user) http.user = user;

  return RequestContext.run(http, async () => {
    const t = await FlowTest.mount(PageClass);
    Object.assign(t.page(), state);
    await t.render();

    // The layout as the route applies it, around the markup the page just rendered.
    const page = t.page() as unknown as Page;
    const document = await page.layout({ html: `<div data-flow-page>${t.html()}</div>` });
    return document.html;
  });
}
