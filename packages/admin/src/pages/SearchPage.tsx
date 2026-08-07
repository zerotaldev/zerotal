/** @jsxImportSource @zerotal/flow */
// Global search. Queries every globally-searchable resource for the `?q=` term
// and groups the matches, each linking to its View page. Reuses each resource's
// `records({ search })` (its searchable columns), so there's no separate search
// index to maintain.

import { Component, url } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { AdminLayout, makeAdminLayout } from "../ui/AdminLayout.tsx";
import { Icon } from "../ui/icons.tsx";
import { Panel } from "../Panel.ts";
import type { PanelInstance } from "../PanelInstance.ts";

const PER_RESOURCE = 5;

export class SearchPage extends Component {
  static layout = AdminLayout;
  /** The panel this page belongs to — set by each generated subclass. */
  static panel: PanelInstance;

  @url q = "";

  private get _panel(): PanelInstance {
    return (this.constructor as typeof SearchPage).panel ?? Panel.current();
  }

  override async render(): Promise<HtmlNode> {
    const panel = this._panel;
    const base = panel.base();
    const term = this.q.trim();

    const groups = term
      ? (
          await Promise.all(
            panel
              .resources()
              .filter((r) => r.globallySearchable())
              .map(async (r) => {
                const result = await r.records({ search: term, perPage: PER_RESOURCE });
                return { resource: r, rows: result.rows, total: result.total };
              }),
          )
        ).filter((g) => g.rows.length > 0)
      : [];

    // Contributed sources — jobs, log lines, audit entries, anything a package
    // can address by URL. A provider that throws is dropped rather than taking
    // the whole results page down with it.
    const contributed = term
      ? (
          await Promise.all(
            (await panel.visibleSearchProviders()).map(async (p) => {
              try {
                return { provider: p, hits: (await p.search(term)).slice(0, PER_RESOURCE) };
              } catch {
                return { provider: p, hits: [] };
              }
            }),
          )
        ).filter((g) => g.hits.length > 0)
      : [];

    const totalHits =
      groups.reduce((n, g) => n + g.total, 0) + contributed.reduce((n, g) => n + g.hits.length, 0);

    return (
      <div class="mx-auto w-full max-w-3xl space-y-6">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">Search</h1>
          {term ? (
            <p class="mt-1 text-sm text-muted-foreground">
              {totalHits} {totalHits === 1 ? "result" : "results"} for “{term}”
            </p>
          ) : (
            <p class="mt-1 text-sm text-muted-foreground">
              Type a query in the search box above to look across your resources.
            </p>
          )}
        </div>

        {term && groups.length === 0 && contributed.length === 0 ? (
          <div class="rounded-xl border border-dashed border-border p-12 text-center">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon name="search" class="h-6 w-6" />
            </div>
            <p class="mt-3 text-sm font-medium">No matches</p>
            <p class="mt-1 text-sm text-muted-foreground">Nothing matched “{term}”.</p>
          </div>
        ) : null}

        {groups.map((g) => (
          <div class="rounded-xl border border-border bg-card text-card-foreground shadow-sm">
            <div class="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <Icon name={g.resource.navigationIcon} class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm font-semibold">{g.resource.getPluralLabel()}</span>
              <span class="text-xs text-muted-foreground">({g.total})</span>
            </div>
            <ul class="divide-y divide-border">
              {g.rows.map((row) => (
                <li>
                  <a
                    href={`${base}/${g.resource.getSlug()}/${String(row[g.resource.primaryKey])}`}
                    navigate
                    class="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition hover:bg-accent"
                  >
                    <span class="truncate">{g.resource.recordTitle(row)}</span>
                    <Icon name="chevron-right" class="h-4 w-4 shrink-0 text-muted-foreground" />
                  </a>
                </li>
              ))}
              {g.total > g.rows.length ? (
                <li>
                  <a
                    href={`${base}/${g.resource.getSlug()}?search=${encodeURIComponent(term)}`}
                    navigate
                    class="block px-4 py-2 text-xs font-medium text-primary hover:underline"
                  >
                    See all {g.total} {g.resource.getPluralLabel().toLowerCase()} →
                  </a>
                </li>
              ) : null}
            </ul>
          </div>
        ))}

        {contributed.map((g) => (
          <div class="rounded-xl border border-border bg-card text-card-foreground shadow-sm">
            <div class="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <Icon name={g.provider.icon ?? "search"} class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm font-semibold">{g.provider.label}</span>
              <span class="text-xs text-muted-foreground">({g.hits.length})</span>
            </div>
            <ul class="divide-y divide-border">
              {g.hits.map((hit) => (
                <li>
                  <a
                    href={hit.href}
                    navigate
                    class="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition hover:bg-accent"
                  >
                    <span class="min-w-0">
                      <span class="block truncate">{hit.label}</span>
                      {hit.description ? (
                        <span class="block truncate text-xs text-muted-foreground">
                          {hit.description}
                        </span>
                      ) : null}
                    </span>
                    <Icon name="chevron-right" class="h-4 w-4 shrink-0 text-muted-foreground" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }
}

/** The search page for one panel, searching only that panel's resources. */
export function makeSearchPage(panel: PanelInstance = Panel.default()): typeof SearchPage {
  const Page = class extends SearchPage {
    static override panel = panel;
    static override layout = makeAdminLayout(panel);
  };
  Object.defineProperty(Page, "name", { value: "SearchPage" });
  return Page;
}
