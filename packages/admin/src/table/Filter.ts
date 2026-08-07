/**
 * Table filters. A filter scopes the list query and
 * its active value lives in the URL (`?filters=…`), so it composes cleanly with
 * search, sort, tabs, and pagination — every one of which is URL-driven.
 *
 *   selectFilter("status").options({ active: "Active", archived: "Archived" })
 *   ternaryFilter("verified")
 *     .label("Email verified")
 *     .query((q, v) => (v === "1" ? q.whereNotNull!("email_verified_at") : q.whereNull!("email_verified_at")))
 */
import type { AdminQuery } from "../Resource.ts";
import type { Conjunction, Constraint } from "./Constraint.ts";

export type FilterType = "select" | "ternary" | "builder" | "text";

/**
 * A node in a query-builder filter's rule tree: either one comparison, or a
 * group combining several with `AND`/`OR`. Groups nest, so "status is paid AND
 * (total > 100 OR customer contains acme)" is expressible.
 */
export type QueryRule =
  | { type: "rule"; constraint: string; operator: string; value?: string }
  | { type: "group"; operator: Conjunction; rules: QueryRule[] };

/** Parse the JSON a query-builder filter stores in the URL. Invalid input filters nothing. */
export function parseRuleTree(value: string): QueryRule | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRule(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRule(node: unknown): node is QueryRule {
  if (!node || typeof node !== "object") return false;
  const n = node as Record<string, unknown>;
  if (n["type"] === "rule")
    return typeof n["constraint"] === "string" && typeof n["operator"] === "string";
  if (n["type"] === "group") return Array.isArray(n["rules"]) && n["rules"].every(isRule);
  return false;
}

/**
 * A short human summary of a rule tree, for the active-filter chips.
 *
 * "Advanced filter: 3 rules" tells someone their list is narrowed and by roughly
 * how much; the builder itself shows the detail. One rule gets named outright,
 * since that is the common case and the label fits.
 */
export function describeRuleTree(
  node: QueryRule | null,
  filter?: { _constraints: Constraint[] },
): string {
  if (!node) return "none";
  const rules: Extract<QueryRule, { type: "rule" }>[] = [];
  const walk = (n: QueryRule): void => {
    if (n.type === "rule") rules.push(n);
    else n.rules.forEach(walk);
  };
  walk(node);

  if (rules.length === 0) return "none";
  if (rules.length === 1) {
    const rule = rules[0]!;
    const constraint = filter?._constraints.find((c) => c._key === rule.constraint);
    const label = constraint?.getLabel() ?? rule.constraint;
    const operator =
      constraint?.operators().find((o) => o.value === rule.operator)?.label ?? rule.operator;
    return [label, operator, rule.value].filter(Boolean).join(" ");
  }
  return `${rules.length} rules`;
}

/** Does this tree actually constrain anything? An empty group is a no-op. */
export function ruleTreeIsEmpty(node: QueryRule | null): boolean {
  if (!node) return true;
  if (node.type === "rule") return false;
  return node.rules.every(ruleTreeIsEmpty);
}

export interface FilterOption {
  value: string;
  label: string;
}

export type FilterApply = (query: AdminQuery, value: string) => AdminQuery;

export class Filter {
  /** @internal */ _key: string;
  /** @internal */ _label?: string;
  /** @internal */ _type: FilterType;
  /** @internal */ _column?: string;
  /** @internal */ _options: FilterOption[] = [];
  /** @internal */ _apply?: FilterApply;
  /** @internal */ _trueLabel = "Yes";
  /** @internal */ _falseLabel = "No";
  /** @internal Available comparisons, for a query-builder filter. */ _constraints: Constraint[] =
    [];

  constructor(key: string, type: FilterType = "select") {
    this._key = key;
    this._type = type;
  }

  static make(key: string): Filter {
    return new Filter(key);
  }

  label(label: string): this {
    this._label = label;
    return this;
  }

  /** Column to filter on (defaults to the filter key). */
  column(column: string): this {
    this._column = column;
    return this;
  }

  /** Options for a select filter — `{value: label}` map or `{value,label}[]`. */
  options(options: Record<string, string> | FilterOption[]): this {
    this._options = Array.isArray(options)
      ? options
      : Object.entries(options).map(([value, label]) => ({ value, label }));
    return this;
  }

  /** Labels for the two states of a ternary filter. */
  labels(trueLabel: string, falseLabel: string): this {
    this._trueLabel = trueLabel;
    this._falseLabel = falseLabel;
    return this;
  }

  /** Comparisons a query-builder filter offers. */
  constraints(constraints: Constraint[]): this {
    this._constraints = constraints;
    return this;
  }

  /** Custom query scope; receives the raw active value. */
  query(fn: FilterApply): this {
    this._apply = fn;
    return this;
  }

  getLabel(): string {
    return this._label ?? titleCase(this._key);
  }

  /** The selectable options including the implicit "all"/ternary states. */
  choices(): FilterOption[] {
    if (this._type === "ternary") {
      return [
        { value: "1", label: this._trueLabel },
        { value: "0", label: this._falseLabel },
      ];
    }
    return this._options;
  }

  /** Apply this filter's scope for a chosen value. */
  apply(query: AdminQuery, value: string): AdminQuery {
    if (this._apply) return this._apply(query, value);
    if (this._type === "builder") return this._applyRuleTree(query, value);
    const col = this._column ?? this._key;
    if (this._type === "ternary") return query.where(col, value === "1");
    // A typed-in filter matches anywhere in the value: someone typing three
    // letters into a header box is looking for a substring, not an exact row.
    if (this._type === "text") return query.where(col, "like", `%${value}%`);
    return query.where(col, value);
  }

  /**
   * Apply a rule tree, wrapping the whole thing in one group.
   *
   * The wrapper matters: without it an `OR` at the top level would break out of
   * whatever scope the list page already applied — a tab, a parent record, a
   * soft-delete filter — and widen the result set past what the user is allowed
   * to see. Grouping keeps the tree a single `AND`ed unit.
   */
  private _applyRuleTree(query: AdminQuery, value: string): AdminQuery {
    const tree = parseRuleTree(value);
    if (ruleTreeIsEmpty(tree)) return query;
    const byKey = new Map(this._constraints.map((c) => [c._key, c]));
    const group: Extract<QueryRule, { type: "group" }> =
      tree!.type === "group" ? tree! : { type: "group", operator: "and", rules: [tree!] };

    // Nothing survives validation — an unknown constraint, a rule still waiting
    // for its value. Emitting the wrapper anyway would leave an empty `WHERE ()`.
    if (!hasApplicableRule(group, byKey)) return query;

    return query.where((sub: AdminQuery) => applyGroup(sub, group, byKey));
  }
}

/** Whether any rule in this subtree names a known constraint and is complete. */
function hasApplicableRule(node: QueryRule, byKey: Map<string, Constraint>): boolean {
  if (node.type === "group") return node.rules.some((r) => hasApplicableRule(r, byKey));
  const constraint = byKey.get(node.constraint);
  if (!constraint) return false;
  return constraint.isUnary(node.operator) || Boolean(node.value);
}

/** Add a group's rules to `query`, each joined by the group's operator. */
function applyGroup(
  query: AdminQuery,
  group: Extract<QueryRule, { type: "group" }>,
  byKey: Map<string, Constraint>,
): void {
  let first = true;
  for (const rule of group.rules) {
    if (ruleTreeIsEmpty(rule)) continue;
    // The first predicate in a group always joins with AND — there is nothing
    // yet for it to be an alternative to.
    const conjunction: Conjunction = first ? "and" : group.operator;

    if (rule.type === "group") {
      // Same reasoning as the outer wrapper: skip a subgroup with nothing to say.
      if (!hasApplicableRule(rule, byKey)) continue;
      const nest = (conjunction === "or" ? query.orWhere : query.where) as
        ((fn: (sub: AdminQuery) => void) => AdminQuery) | undefined;
      if (typeof nest !== "function") continue;
      nest.call(query, (sub: AdminQuery) => applyGroup(sub, rule, byKey));
    } else {
      const constraint = byKey.get(rule.constraint);
      // An unknown constraint is a URL naming a column the resource never
      // offered — drop it rather than filtering on attacker-chosen input.
      if (!constraint) continue;
      if (!constraint.isUnary(rule.operator) && !rule.value) continue;
      constraint.apply(query, rule.operator, rule.value ?? "", conjunction);
    }
    first = false;
  }
}

/** Single-choice dropdown filter. */
export function selectFilter(key: string): Filter {
  return new Filter(key, "select");
}

/** Free-text filter, matching anywhere in the column. */
export function textFilter(key: string): Filter {
  return new Filter(key, "text");
}

/** Three-state filter — all / yes / no. */
export function ternaryFilter(key: string): Filter {
  return new Filter(key, "ternary");
}

/**
 * A build-your-own filter: the user stacks comparisons and nests AND/OR groups
 * rather than picking from fixed choices. Declare what may be compared with
 * {@link Filter.constraints}.
 *
 *   queryBuilder("q").constraints([
 *     textConstraint("name"),
 *     numberConstraint("total"),
 *     selectConstraint("status").options({ open: "Open", closed: "Closed" }),
 *   ])
 */
export function queryBuilder(key: string): Filter {
  return new Filter(key, "builder");
}

function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
