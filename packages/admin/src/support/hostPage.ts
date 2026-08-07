/**
 * Put a page inside the panel's chrome without touching the class that was
 * handed over.
 *
 * A contributed page is owned by the package that wrote it, and that package may
 * mount the same class somewhere else — its own standalone panel, say. Assigning
 * `PageClass.layout = AdminLayout` would reach across and change it there too, so
 * the panel hosts a *subclass* instead and leaves the original alone.
 *
 * The subclass keeps the original's name because Flow's component registry is
 * keyed by constructor name: the browser sends that name back with every action
 * frame, and an anonymous class would break the round-trip. Names being the key
 * also means a single class can only be mounted under one route at a time — a
 * page that wants to appear in two panels needs a distinct class per panel.
 *
 * Decorator metadata (`@expose`, `@url`, `@on`, …) is collected by walking the
 * prototype chain, so it inherits into the subclass and interactivity survives.
 */
import { AdminLayout } from "../ui/AdminLayout.tsx";
import type { PanelPageClass } from "../plugin.ts";

export function hostedPage(PageClass: PanelPageClass): PanelPageClass {
  if ((PageClass as { layout?: unknown }).layout === AdminLayout) return PageClass;

  const Hosted = class extends PageClass {
    static layout = AdminLayout;
  };
  Object.defineProperty(Hosted, "name", { value: PageClass.name, configurable: true });
  return Hosted;
}
