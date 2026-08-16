/**
 * Turning flat records into the nested views the panel draws.
 *
 * Two shapings, both pure and both testable without a DOM: dotted prop paths
 * into a tree, and a set of traces into correlated groups.
 */
import type { RequestTrace, TraceChannelDescriptor } from "../RequestTrace.ts";

/** A node of a dotted-path tree: a leaf with attributes, a branch with children, or both. */
export interface PathTreeNode {
  children: Map<string, PathTreeNode>;
  /** The node's own attributes, or null for a branch nothing was recorded against. */
  attrs: Record<string, unknown> | null;
}

/**
 * Split a map of dotted paths into the tree the dots already describe.
 *
 * `user.name` and `user.email` are two entries in a flat record and one branch
 * with two leaves on screen — which is the difference between reading a prop bag
 * and scanning one. A path can be both: `user` may carry attributes of its own
 * *and* have children, so a branch keeps its `attrs` rather than being treated as
 * a container.
 *
 * @param paths - Dotted path → that node's attributes.
 */
export function buildPathTree(paths: Array<[string, unknown]>): Map<string, PathTreeNode> {
  const root = new Map<string, PathTreeNode>();
  for (const [path, attrs] of paths) {
    let level = root;
    const parts = path.split(".");
    parts.forEach((part, i) => {
      let node = level.get(part);
      if (!node) {
        node = { children: new Map(), attrs: null };
        level.set(part, node);
      }
      if (i === parts.length - 1) {
        node.attrs = attrs && typeof attrs === "object" ? (attrs as Record<string, unknown>) : {};
      }
      level = node.children;
    });
  }
  return root;
}

/**
 * The value that groups this trace with others, from whichever channel declared
 * a `traceGroup` field. Null when nothing correlates it.
 *
 * One user action can be several requests — a visit, then the deferred-prop loads
 * it triggers — and listing them as unrelated siblings is how the thing you are
 * debugging scrolls off the top. Which field says so is the channel's to declare,
 * so this stays free of any package's vocabulary.
 *
 * The id is prefixed with the channel's, so two channels that both correlate
 * cannot collide on a shared value.
 */
export function traceGroupKey(
  trace: RequestTrace,
  channels: TraceChannelDescriptor[],
): string | null {
  for (const c of channels) {
    if (!c.traceGroup) continue;
    const value = trace.channels?.[c.id]?.[0]?.[c.traceGroup];
    if (value != null && value !== "") return `${c.id}:${String(value)}`;
  }
  return null;
}

/** One line of the All tab: a trace, its index in the full list, and its nesting. */
export interface TraceRow {
  trace: RequestTrace;
  /** Index into the *unfiltered* trace list, so a click still selects the right one. */
  index: number;
  /** True for a follow-up shown under its group head. */
  child: boolean;
  /** The group this row heads, when it heads one. */
  groupKey?: string;
  /** How many follow-ups are folded under this head. */
  groupSize?: number;
}

/**
 * Flatten the filtered traces into the rows the All tab draws, folding correlated
 * requests under the oldest of each set.
 *
 * A group takes the position of its *newest* member, so a batch still receiving
 * follow-ups stays where you are looking rather than sinking as it grows. The
 * head is its oldest member — the request that started it — because that is the
 * one you meant to click.
 *
 * Kept separate from the rendering so the All tab's structure can be asserted on
 * without a DOM, and so virtualisation has a flat array to window over.
 */
export function foldTraceRows(
  matches: Array<{ trace: RequestTrace; index: number }>,
  channels: TraceChannelDescriptor[],
  expanded: ReadonlySet<string>,
): TraceRow[] {
  const order: string[] = [];
  const groups = new Map<string, Array<{ trace: RequestTrace; index: number }>>();

  for (const m of matches) {
    // Uncorrelated traces get a key of their own so they never merge with each
    // other — the fallback has to be unique, not shared.
    const key = traceGroupKey(m.trace, channels) ?? `#${m.index}`;
    let bucket = groups.get(key);
    if (!bucket) {
      groups.set(key, (bucket = []));
      order.push(key);
    }
    bucket.push(m);
  }

  const rows: TraceRow[] = [];
  for (const key of order) {
    const members = groups.get(key)!;
    if (members.length === 1) {
      rows.push({ trace: members[0]!.trace, index: members[0]!.index, child: false });
      continue;
    }
    // Oldest last, because the list is newest-first.
    const head = members[members.length - 1]!;
    const rest = members.slice(0, -1);
    rows.push({
      trace: head.trace,
      index: head.index,
      child: false,
      groupKey: key,
      groupSize: rest.length,
    });
    if (expanded.has(key)) {
      for (const m of rest) rows.push({ trace: m.trace, index: m.index, child: true });
    }
  }
  return rows;
}
