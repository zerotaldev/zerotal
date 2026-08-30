// Test fixture: the same layout done correctly, reading props with usePage().
import { createElement } from "react";
import { usePage } from "@inertiajs/react";

function Shell({ children }: { children?: unknown }) {
  const { props } = usePage<{ search?: string }>();
  return createElement("main", { id: "shell" }, String(props.search ?? ""), children as never);
}

function Page(props: Record<string, unknown>) {
  return createElement("div", { id: "page" }, String(props.title ?? ""));
}

(Page as unknown as { layout: (page: unknown) => unknown }).layout = (page: unknown) =>
  createElement(Shell, null, page as never);

export default Page;
