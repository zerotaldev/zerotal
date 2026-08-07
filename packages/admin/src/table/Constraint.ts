/**
 * Constraints — the building blocks of the query-builder filter.
 *
 * A constraint names one thing a user may filter on and the operators that make
 * sense for it, so the panel can offer "Title contains …" and "Total is greater
 * than …" without the app writing either query:
 *
 *   queryBuilder("q").constraints([
 *     textConstraint("title"),
 *     numberConstraint("total").label("Order total"),
 *     dateConstraint("created_at").label("Placed"),
 *     selectConstraint("status").options({ paid: "Paid", refunded: "Refunded" }),
 *     booleanConstraint("featured"),
 *   ])
 *
 * Each constraint knows how to turn a chosen operator and value into query
 * predicates, and applies them with either `AND` or `OR` so a rule can sit in
 * either kind of group.
 */
import type { AdminQuery } from "../Resource.ts";

export type ConstraintKind = "text" | "number" | "date" | "boolean" | "select";

/** One comparison a constraint offers. */
export interface ConstraintOperator {
  value: string;
  label: string;
  /** True when the operator stands alone — "is empty" takes no value input. */
  unary?: boolean;
}

export interface ConstraintOption {
  value: string;
  label: string;
}

/** Whether a rule joins what came before it with `AND` or `OR`. */
export type Conjunction = "and" | "or";

const TEXT_OPERATORS: ConstraintOperator[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "is_empty", label: "is empty", unary: true },
  { value: "is_not_empty", label: "is not empty", unary: true },
];

const NUMBER_OPERATORS: ConstraintOperator[] = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "gt", label: "is greater than" },
  { value: "gte", label: "is at least" },
  { value: "lt", label: "is less than" },
  { value: "lte", label: "is at most" },
  { value: "is_empty", label: "is blank", unary: true },
  { value: "is_not_empty", label: "is set", unary: true },
];

const DATE_OPERATORS: ConstraintOperator[] = [
  { value: "equals", label: "is on" },
  { value: "lt", label: "is before" },
  { value: "gt", label: "is after" },
  { value: "is_empty", label: "is blank", unary: true },
  { value: "is_not_empty", label: "is set", unary: true },
];

const BOOLEAN_OPERATORS: ConstraintOperator[] = [
  { value: "is_true", label: "is true", unary: true },
  { value: "is_false", label: "is false", unary: true },
];

const SELECT_OPERATORS: ConstraintOperator[] = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "is_empty", label: "is blank", unary: true },
  { value: "is_not_empty", label: "is set", unary: true },
];

export class Constraint {
  /** @internal */ _key: string;
  /** @internal */ _kind: ConstraintKind;
  /** @internal */ _label?: string;
  /** @internal */ _column?: string;
  /** @internal */ _options: ConstraintOption[] = [];

  constructor(key: string, kind: ConstraintKind = "text") {
    this._key = key;
    this._kind = kind;
  }

  label(label: string): this {
    this._label = label;
    return this;
  }

  /** Database column to compare, when it differs from the constraint key. */
  column(column: string): this {
    this._column = column;
    return this;
  }

  /** Choices for a select constraint — `{value: label}` map or `{value,label}[]`. */
  options(options: Record<string, string> | ConstraintOption[]): this {
    this._options = Array.isArray(options)
      ? options
      : Object.entries(options).map(([value, label]) => ({ value, label }));
    return this;
  }

  getLabel(): string {
    return this._label ?? titleCase(this._key);
  }

  getColumn(): string {
    return this._column ?? this._key;
  }

  operators(): ConstraintOperator[] {
    switch (this._kind) {
      case "number":
        return NUMBER_OPERATORS;
      case "date":
        return DATE_OPERATORS;
      case "boolean":
        return BOOLEAN_OPERATORS;
      case "select":
        return SELECT_OPERATORS;
      default:
        return TEXT_OPERATORS;
    }
  }

  /** Whether `operator` stands alone, needing no value from the user. */
  isUnary(operator: string): boolean {
    return this.operators().find((o) => o.value === operator)?.unary === true;
  }

  /**
   * Add this rule's predicates to `query`, joined by `conjunction`.
   *
   * Every branch picks between the `where*` and `orWhere*` families rather than
   * emitting a bare `OR`, so a rule always combines with its siblings as one
   * unit and never splits a surrounding scope.
   */
  apply(query: AdminQuery, operator: string, value: string, conjunction: Conjunction): AdminQuery {
    const col = this.getColumn();
    const or = conjunction === "or";
    const q = query as AdminQuery &
      Record<string, ((...args: unknown[]) => AdminQuery) | undefined>;
    const call = (name: string, ...args: unknown[]): AdminQuery => {
      const fn = q[name];
      // The query surface is intentionally loose (resources run under partial
      // mocks in tests); an unsupported method leaves the query unfiltered
      // rather than throwing mid-render.
      return typeof fn === "function" ? fn.apply(query, args) : query;
    };
    const like = (pattern: string): AdminQuery =>
      call(or ? "orWhereLike" : "whereLike", col, pattern);
    const compare = (op: string, v: unknown): AdminQuery =>
      or ? call("orWhere", col, op, v) : query.where(col, op, v);

    switch (operator) {
      case "contains":
        return like(`%${value}%`);
      case "not_contains":
        return call(or ? "orWhereNotLike" : "whereNotLike", col, `%${value}%`);
      case "starts_with":
        return like(`${value}%`);
      case "ends_with":
        return like(`%${value}`);
      case "equals":
        return compare("=", this._cast(value));
      case "not_equals":
        return compare("!=", this._cast(value));
      case "gt":
        return compare(">", this._cast(value));
      case "gte":
        return compare(">=", this._cast(value));
      case "lt":
        return compare("<", this._cast(value));
      case "lte":
        return compare("<=", this._cast(value));
      case "is_true":
        return compare("=", true);
      case "is_false":
        return compare("=", false);
      case "is_empty":
        return call(or ? "orWhereNull" : "whereNull", col);
      case "is_not_empty":
        return call(or ? "orWhereNotNull" : "whereNotNull", col);
      default:
        return query;
    }
  }

  /** Coerce the submitted string to the type the column actually holds. */
  private _cast(value: string): unknown {
    if (this._kind !== "number") return value;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
}

/** Free-text constraint — contains / starts with / is / is empty. */
export function textConstraint(key: string): Constraint {
  return new Constraint(key, "text");
}

/** Numeric constraint — comparisons and ranges. */
export function numberConstraint(key: string): Constraint {
  return new Constraint(key, "number");
}

/** Date constraint — on / before / after. */
export function dateConstraint(key: string): Constraint {
  return new Constraint(key, "date");
}

/** Boolean constraint — is true / is false. */
export function booleanConstraint(key: string): Constraint {
  return new Constraint(key, "boolean");
}

/** Fixed-choice constraint — is / is not one of the declared options. */
export function selectConstraint(key: string): Constraint {
  return new Constraint(key, "select");
}

function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
