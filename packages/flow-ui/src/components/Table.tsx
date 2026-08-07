// ── <Table> ─────────────────────────────────────────────────────────────────
//
// A themed data table, with Flow's URL-driven
// sortable headers. Clicking a sortable header navigates to
// `?sortBy=key&sortDir=asc|desc` (toggling) — pair with `@url sortBy`/`@url sortDir`
// and sort rows server-side in render(). `params` preserves other query state.
//
//   <Table columns={[{ key:"name", label:"Name", sortable:true }, …]} rows={p.data}
//          sortBy={this.sortBy} sortDir={this.sortDir} hover />

import { jsx } from "@zerotal/flow/jsx-runtime";
import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface TableColumn<T = Record<string, unknown>> {
  key: string;
  label: unknown;
  sortable?: boolean;
  /** Custom cell renderer; defaults to `row[key]`. */
  render?: (row: T) => unknown;
  /** Extra classes for this column's cells. */
  class?: string | undefined;
}

/** A contiguous block of rows under a shared header. */
export interface TableGroup<T = Record<string, unknown>> {
  /** Stable key for morphing. */
  key: string;
  /** Header content, rendered in a full-width row above the group. */
  header: unknown;
  rows: T[];
  /** Optional per-group summary cells, aligned 1:1 with `columns`. */
  footerCells?: unknown[] | undefined;
}

export interface TableProps<T = Record<string, unknown>> {
  columns: TableColumn<T>[];
  rows: T[];
  sortBy?: string;
  sortDir?: "asc" | "desc";
  /** Extra query params to keep in sort links (e.g. a search term). */
  params?: Record<string, string | number | null | undefined>;
  /** Field used as the row key (defaults to the first column's key). */
  rowKey?: string;
  hover?: boolean;
  /** Render grouped row blocks (with header rows) instead of flat `rows`. */
  groups?: TableGroup<T>[] | undefined;
  /** A table-level summary row (`<tfoot>`), cells aligned 1:1 with `columns`. */
  footerCells?: unknown[] | undefined;
  /**
   * A second header row for per-column controls — filter boxes, say — with
   * cells aligned 1:1 with `columns`. Inside `<thead>` so the controls stay put
   * when the body scrolls, and so a screen reader reads them as belonging to
   * their column rather than as a stray first row of data.
   */
  filterCells?: unknown[] | undefined;
  class?: string;
  theadClass?: string;
  [key: string]: unknown;
}

export function Table<T extends Record<string, unknown>>(props: TableProps<T>): HtmlNode {
  const {
    columns,
    rows,
    sortBy,
    sortDir,
    params,
    rowKey,
    hover,
    groups,
    footerCells,
    filterCells,
    class: cls,
    theadClass,
    children: _ignore,
    ...rest
  } = props as TableProps<T> & { children?: unknown };
  const keyField = rowKey ?? columns[0]?.key ?? "id";

  const sortHref = (key: string) => {
    const nextDir = key === sortBy && sortDir === "asc" ? "desc" : "asc";
    const sp = new URLSearchParams();
    sp.set("sortBy", key);
    sp.set("sortDir", nextDir);
    if (params)
      for (const [k, v] of Object.entries(params))
        if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
    return "?" + sp.toString();
  };

  const headCells = columns.map((col) => {
    const thClass = "h-10 px-2 text-left align-middle font-medium text-muted-foreground";
    if (!col.sortable) {
      return jsx("th", { scope: "col", class: thClass, children: col.label });
    }
    const active = col.key === sortBy;
    const indicator = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
    return jsx("th", {
      scope: "col",
      "aria-sort": active ? (sortDir === "asc" ? "ascending" : "descending") : "none",
      class: thClass,
      children: jsx("a", {
        href: sortHref(col.key),
        navigate: true,
        ...(hover ? { navigateHover: true } : {}),
        class: "inline-flex items-center gap-0.5 hover:text-foreground",
        children: [col.label, indicator],
      }),
    });
  });

  const dataRow = (row: T) =>
    jsx("tr", {
      "flow:key": String(row[keyField] ?? ""), // morph keys rows by identity (sort/filter reorders)
      class: cn("border-b border-border transition-colors", hover && "hover:bg-muted/50"),
      children: columns.map((col) =>
        jsx("td", {
          class: cn("p-2 align-middle", col.class),
          children: col.render ? col.render(row) : (row[col.key] as unknown),
        }),
      ),
    });

  // A summary row from cells aligned 1:1 with `columns` (table-level or per-group).
  const summaryRow = (cells: unknown[], key: string) =>
    jsx("tr", {
      "flow:key": key,
      class: "border-t border-border bg-muted/30",
      children: columns.map((col, i) =>
        jsx("td", { class: cn("p-2 align-top", col.class), children: cells[i] ?? null }),
      ),
    });

  let bodyChildren: unknown[];
  if (groups && groups.length > 0) {
    bodyChildren = groups.flatMap((g) => {
      const block: unknown[] = [
        jsx("tr", {
          "flow:key": `g:${g.key}`,
          class: "border-b border-border bg-muted/40",
          children: jsx("td", {
            colspan: columns.length,
            class: "px-2 py-2 align-middle font-medium",
            children: g.header,
          }),
        }),
        ...g.rows.map(dataRow),
      ];
      if (g.footerCells) block.push(summaryRow(g.footerCells, `gf:${g.key}`));
      return block;
    });
  } else {
    bodyChildren = rows.map(dataRow);
  }

  const children: unknown[] = [
    jsx("thead", {
      class: cn("[&_tr]:border-b [&_tr]:border-border", theadClass),
      children: filterCells
        ? [
            jsx("tr", { children: headCells }),
            jsx("tr", {
              "flow:key": "__filters",
              children: columns.map((col, i) =>
                jsx("th", {
                  class: cn("px-2 pb-2 align-top font-normal", col.class),
                  children: filterCells[i] ?? null,
                }),
              ),
            }),
          ]
        : jsx("tr", { children: headCells }),
    }),
    jsx("tbody", { children: bodyChildren }),
  ];
  if (footerCells) {
    children.push(
      jsx("tfoot", { class: "font-medium", children: summaryRow(footerCells, "__tfoot") }),
    );
  }

  return jsx("table", {
    ...rest,
    class: cn("w-full caption-bottom border-collapse text-sm", cls),
    children,
  });
}
