// Test fixture: the mistake that shipped a blank page to production.
//
// `Page.layout` receives the child *element*, not the page props — so
// `page.props.search` is a read of `undefined`. The route still answers 200 with a
// correct Inertia payload; the failure is entirely in the browser's first paint.
import { createElement } from "react";

function Page(props: Record<string, unknown>) {
  return createElement("div", { id: "broken" }, String(props.title ?? ""));
}

(Page as unknown as { layout: (page: unknown) => unknown }).layout = (page: unknown) =>
  createElement(
    "main",
    null,
    // The bug, verbatim: the element has no `props.search`.
    String((page as { props: { search: string } }).props.search),
  );

export default Page;
