/** @jsxImportSource @zerotal/flow */
// Where a panel page sits, and every step back out.
//
// The trail matters most once resources stop being flat. A record three levels
// down — panel → cluster → parent record → nested resource → record — has no
// other affordance for climbing back to the middle of that path.
//
// The rendering is `@zerotal/flow-ui`'s; what lives here is `resourceTrail`,
// which knows how a panel's URLs are built.

import type { HtmlNode } from "@zerotal/flow";
import { Breadcrumb } from "@zerotal/flow-ui";
import type { PanelInstance } from "../PanelInstance.ts";
import type { ResourceClass } from "../Panel.ts";

/** One step in the trail. The last one is where you are, so it has no link. */
export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ trail }: { trail: Crumb[] }): HtmlNode {
  // Collapsed past five steps: a deeply nested record produces a trail that
  // wraps onto two lines otherwise, and the middle is the part nobody clicks.
  return <Breadcrumb items={trail} maxItems={5} class="mb-1" />;
}

export interface TrailOptions {
  panel: PanelInstance;
  resource: ResourceClass;
  /** The parent record's id, for a nested resource. */
  parentId?: string | undefined;
  /** Title of the parent record, when it has been loaded. */
  parentTitle?: string | undefined;
  /** The final step — a record title, "New", "Edit". Omit on an index page. */
  leaf?: string | undefined;
  /** Link the resource step even when it is the last one (used on edit pages). */
  recordId?: string | undefined;
  recordTitle?: string | undefined;
}

/**
 * Build the trail for a resource page.
 *
 * Each step is derived from the resource's own URL builders, so a resource that
 * moves into a cluster or under a parent gets a correct trail with no extra
 * declaration.
 */
export function resourceTrail(options: TrailOptions): Crumb[] {
  const { panel, resource, parentId, parentTitle, leaf, recordId, recordTitle } = options;
  const base = panel.base();
  const trail: Crumb[] = [{ label: "Dashboard", href: base }];

  if (resource.cluster) {
    // A cluster is a grouping rather than a page, so it points at its own first
    // member — which for a member's own trail is this resource's index.
    trail.push({ label: resource.cluster.title, href: resource.indexUrl(base, parentId) });
  }

  const parent = resource.parentResource();
  if (parent && parentId) {
    trail.push({ label: parent.getPluralLabel(), href: parent.indexUrl(base) });
    trail.push({
      label: parentTitle ?? `#${parentId}`,
      href: parent.recordUrl(base, parentId),
    });
  }

  const needsResourceLink = Boolean(leaf || recordId);
  trail.push({
    label: resource.getPluralLabel(),
    ...(needsResourceLink ? { href: resource.indexUrl(base, parentId) } : {}),
  });

  if (recordId) {
    trail.push({
      label: recordTitle ?? `#${recordId}`,
      ...(leaf ? { href: resource.recordUrl(base, recordId, parentId) } : {}),
    });
  }
  if (leaf) trail.push({ label: leaf });

  return trail;
}
