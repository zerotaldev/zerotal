/**
 * A channel tab, drawn from its descriptor alone.
 *
 * Five presentations rather than one, because a flat badge-title-meta list is
 * right for an audit feed and wrong for a prop map or a route table — and a
 * package that needs a tree should not have to ship a renderer into devtools to
 * get one. Which presentation to use is declared as data like everything else on
 * the descriptor, so this file stays the only channel-rendering code in the panel
 * however many packages contribute.
 */
import type { TraceChannelDescriptor, TraceChannelEntry } from "../../RequestTrace.ts";
import { buildPathTree, type PathTreeNode } from "../tree.ts";
import { chipFor, copyBtn, esc, fmt, fmtCell } from "../ui/format.ts";
import type { TabView } from "./types.ts";

/** `key: value` spans for every field the descriptor named as meta. */
function metaLine(r: TraceChannelEntry, keys: string[]): string {
  return keys
    .filter((k) => r[k] != null && r[k] !== "")
    .map((k) => `<span>${esc(k)}: ${esc(fmtCell(r[k]))}</span>`)
    .join("");
}

/**
 * Chips for the descriptor's `flags` that are truthy here.
 *
 * A flag is named by its *field*, so `{ shared: true }` reads as **shared**
 * rather than `shared: true` — which is how a row ends up saying nothing at a
 * glance.
 */
function flagChips(r: Record<string, unknown>, flags: string[] | undefined): string {
  return (flags ?? [])
    .filter((f) => !!r[f])
    .map((f) => `<span class="chip flag">${esc(f)}</span>`)
    .join("");
}

/** The default: one block per entry — badge, title, flags, meta. */
function asRows(rows: TraceChannelEntry[], c: TraceChannelDescriptor): string {
  return (
    `<div>` +
    rows
      .map((r) => {
        const isWarn = !!c.warn && !!r[c.warn];
        const badge = c.badge && r[c.badge] != null ? String(r[c.badge]) : "";
        const titleKey = c.title ?? c.badge;
        const title = titleKey && r[titleKey] != null ? String(r[titleKey]) : "";
        const meta = metaLine(r, c.meta ?? []);
        return (
          `<div class="crow${isWarn ? " warn" : ""}">` +
          `<div class="chead">` +
          (badge ? chipFor(badge, isWarn) : "") +
          flagChips(r, c.flags) +
          `<span class="dim" style="font-size:10px">+${fmt(r.offsetMs)}</span>` +
          copyBtn(JSON.stringify(r, null, 2), "Copy entry") +
          `</div>` +
          (title && title !== badge ? `<div class="cttl">${esc(title)}</div>` : "") +
          (meta ? `<div class="cmeta">${meta}</div>` : "") +
          `</div>`
        );
      })
      .join("") +
    `</div>`
  );
}

/** One row per entry, the descriptor's fields as columns. */
function asTable(rows: TraceChannelEntry[], c: TraceChannelDescriptor): string {
  const titleKey = c.title ?? c.badge;
  const cols = [
    ...(c.badge ? [c.badge] : []),
    ...(titleKey && titleKey !== c.badge ? [titleKey] : []),
    ...(c.meta ?? []),
  ];
  if (!cols.length) return asRows(rows, c);
  return (
    `<table class="ctbl"><thead><tr>` +
    cols.map((k) => `<th>${esc(k)}</th>`).join("") +
    `<th>at</th></tr></thead><tbody>` +
    rows
      .map((r) => {
        const isWarn = !!c.warn && !!r[c.warn];
        return (
          `<tr${isWarn ? ' class="warn"' : ""}>` +
          cols
            .map(
              (k, i) =>
                `<td>${i === 0 && c.badge === k && r[k] != null ? chipFor(String(r[k]), isWarn) : esc(fmtCell(r[k]))}` +
                (i === 0 ? flagChips(r, c.flags) : "") +
                `</td>`,
            )
            .join("") +
          `<td class="dim">+${fmt(r.offsetMs)}</td></tr>`
        );
      })
      .join("") +
    `</tbody></table>`
  );
}

/** Every field of every entry, as a key/value table per entry. */
function asKv(rows: TraceChannelEntry[], c: TraceChannelDescriptor): string {
  const titleKey = c.title ?? c.badge;
  return rows
    .map((r) => {
      const heading = titleKey && r[titleKey] != null ? String(r[titleKey]) : "";
      const cells = Object.entries(r)
        .filter(([k, v]) => k !== "offsetMs" && v != null && v !== "")
        .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(fmtCell(v))}</td></tr>`)
        .join("");
      return (
        `<div class="sec"><div class="stitle">` +
        `${esc(heading || "Entry")} · +${fmt(r.offsetMs)}` +
        copyBtn(JSON.stringify(r, null, 2), "Copy entry") +
        `</div><table class="kv">${cells}</table></div>`
      );
    })
    .join("");
}

/** Entries collected under the value of the descriptor's `groupBy` field. */
function asGrouped(rows: TraceChannelEntry[], c: TraceChannelDescriptor): string {
  const key = c.groupBy;
  if (!key) return asRows(rows, c);
  const groups = new Map<string, TraceChannelEntry[]>();
  for (const r of rows) {
    const g = r[key] == null || r[key] === "" ? "—" : String(r[key]);
    let bucket = groups.get(g);
    if (!bucket) groups.set(g, (bucket = []));
    bucket.push(r);
  }
  return [...groups.entries()]
    .map(
      ([g, entries]) =>
        `<details class="cgrp" open><summary>` +
        `<b>${esc(g)}</b><span class="chip">${entries.length}</span>` +
        (c.warn && entries.some((r) => !!r[c.warn!]) ? '<span class="chip warn">⚠</span>' : "") +
        `</summary>${asRows(entries, c)}</details>`,
    )
    .join("");
}

/** A node's badge, its truthy flags, and whatever else it carries. */
function nodeAttrs(attrs: Record<string, unknown>, c: TraceChannelDescriptor): string {
  const badge = c.treeBadge && attrs[c.treeBadge] != null ? String(attrs[c.treeBadge]) : "";
  const flags = new Set(c.flags ?? []);
  const rest = Object.entries(attrs)
    .filter(([k, v]) => k !== c.treeBadge && !flags.has(k) && v != null && v !== "")
    .map(([k, v]) => `<span class="tattr">${esc(k)}: ${esc(fmtCell(v))}</span>`)
    .join("");
  return (badge ? chipFor(badge, false) : "") + flagChips(attrs, c.flags) + rest;
}

function treeNodes(
  level: Map<string, PathTreeNode>,
  c: TraceChannelDescriptor,
  prefix: string,
): string {
  return [...level.entries()]
    .map(([name, node]) => {
      const path = prefix ? `${prefix}.${name}` : name;
      if (node.children.size === 0) {
        return (
          `<div class="tnode tleaf">` +
          `<span class="tname">${esc(name)}</span>` +
          nodeAttrs(node.attrs ?? {}, c) +
          copyBtn(path, "Copy path") +
          `</div>`
        );
      }
      return (
        `<details class="tnode tbranch" open><summary>` +
        `<span class="tname">${esc(name)}</span>` +
        (node.attrs ? nodeAttrs(node.attrs, c) : "") +
        `<span class="dim tattr">${node.children.size}</span>` +
        copyBtn(path, "Copy path") +
        `</summary><div class="tkids">${treeNodes(node.children, c, path)}</div></details>`
      );
    })
    .join("");
}

/** The entry's own badge/title/meta, above its tree. */
function treeHead(r: TraceChannelEntry, c: TraceChannelDescriptor): string {
  const isWarn = !!c.warn && !!r[c.warn];
  const badge = c.badge && r[c.badge] != null ? String(r[c.badge]) : "";
  const titleKey = c.title ?? c.badge;
  const title = titleKey && r[titleKey] != null ? String(r[titleKey]) : "";
  const meta = metaLine(r, c.meta ?? []);
  if (!badge && !title && !meta) return "";
  return (
    `<div class="rcard">` +
    `<div class="chead">` +
    (badge ? chipFor(badge, isWarn) : "") +
    flagChips(r, c.flags) +
    (title ? `<b>${esc(title)}</b>` : "") +
    `</div>` +
    (meta ? `<div class="cmeta">${meta}</div>` : "") +
    `</div>`
  );
}

/**
 * A map of dotted paths, drawn as the tree the dots already describe.
 *
 * Each node's own fields become its badge, its flags, and a dim attribute line,
 * so a package describes what a node *is* without devtools knowing what any of it
 * means.
 */
function asTree(rows: TraceChannelEntry[], c: TraceChannelDescriptor): string {
  const field = c.treeField;
  if (!field) return asRows(rows, c);

  return rows
    .map((r) => {
      const raw = r[field];
      const head = treeHead(r, c);
      if (!raw || typeof raw !== "object") {
        return head + `<p class="empty">Nothing recorded under ${esc(field)}</p>`;
      }
      const paths = Object.entries(raw as Record<string, unknown>);
      if (!paths.length) return head + `<p class="empty">No ${esc(field)} on this entry</p>`;
      return head + treeNodes(buildPathTree(paths), c, "");
    })
    .join("");
}

/** Build the tab for one declared channel. */
export function channelTab(c: TraceChannelDescriptor): TabView {
  return {
    id: `channel:${c.id}`,
    label: c.label,
    scope: "request",

    badge: ({ trace }) => {
      const rows = trace?.channels?.[c.id] ?? [];
      return { count: rows.length, warn: !!c.warn && rows.some((r) => !!r[c.warn!]) };
    },

    render(host, { trace }) {
      const rows = trace?.channels?.[c.id] ?? [];
      if (!rows.length) {
        host.innerHTML = `<p class="empty">No ${esc(c.label.toLowerCase())} activity during this request</p>`;
        return;
      }
      switch (c.render) {
        case "tree":
          host.innerHTML = asTree(rows, c);
          break;
        case "table":
          host.innerHTML = asTable(rows, c);
          break;
        case "kv":
          host.innerHTML = asKv(rows, c);
          break;
        case "grouped":
          host.innerHTML = asGrouped(rows, c);
          break;
        default:
          host.innerHTML = asRows(rows, c);
      }
    },
  };
}
