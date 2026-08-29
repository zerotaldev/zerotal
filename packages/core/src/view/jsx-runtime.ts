// ── View-component marker ──

import { escapeHtml as escHtml } from "../helpers/html.ts";

/**
 * Well-known symbol stamped onto functions that are Zerotal view components,
 * letting the renderer distinguish page/layout components from ordinary
 * functions. Registered via `Symbol.for` so the marker survives across module
 * realms.
 *
 * @internal
 */
export const VIEW_COMPONENT_SYMBOL = Symbol.for("zerotal.view.component");

/**
 * String-keyed twin of {@link VIEW_COMPONENT_SYMBOL}. Set alongside the symbol
 * as a fallback for tooling or environments that can't read symbol-keyed props.
 *
 * @internal
 */
export const VIEW_COMPONENT_PROP = "__zerotalViewComponent";

/**
 * Tag a function as a Zerotal view component (mutates and returns it) so
 * {@link isViewComponent} recognises it. Marking is best-effort — a frozen
 * function simply stays unmarked. Applied automatically by {@link definePage},
 * {@link defineLayout}, and the JSX factory when it renders a function tag.
 *
 * @param fn - The component function to mark.
 * @returns The same function, now carrying the marker.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- marks any component function, regardless of its specific signature.
export function markViewComponent<T extends Function>(fn: T): T {
  try {
    (fn as unknown as Record<PropertyKey, unknown>)[VIEW_COMPONENT_SYMBOL] = true;
    (fn as unknown as Record<string, unknown>)[VIEW_COMPONENT_PROP] = true;
  } catch {
    /* defining the marker is best-effort — frozen functions just stay unmarked. */
  }
  return fn;
}

/**
 * Whether a value was tagged by {@link markViewComponent} — i.e. it is a Zerotal
 * view component rather than a plain function. Returns `false` for non-functions.
 *
 * @param fn - The value to test.
 */
export function isViewComponent(fn: unknown): boolean {
  if (typeof fn !== "function") return false;
  const f = fn as unknown as Record<PropertyKey, unknown>;
  return f[VIEW_COMPONENT_SYMBOL] === true || f[VIEW_COMPONENT_PROP] === true;
}

// ── SafeHtml ──────────────────────────────────────────────────────────────────

/**
 * Opaque runtime wrapper produced by every JSX expression.
 * Signals to renderChildren() that the value is already-escaped HTML and
 * must NOT be re-escaped. End users should not construct this directly —
 * use JSX syntax or the safe() / Raw helpers from @zerotal/core.
 */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

// ── Global JSX type declarations ──────────────────────────────────────────────
// When a file uses /** @jsxImportSource @zerotal/core */, TypeScript imports this
// module and picks up these declarations, giving full type-safe JSX with
// JSX.Element = SafeHtml (secure by default, never a plain string).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- the JSX namespace is the only way to declare global JSX types.
  namespace JSX {
    type Element = SafeHtml;
    interface ElementChildrenAttribute {
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- ElementChildrenAttribute names the children prop; the value type is irrelevant by JSX convention.
      children: {};
    }
    interface IntrinsicElements {
      [tag: string]: Record<string, unknown> & { children?: unknown };
    }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Function-component type: a function taking typed props (plus optional
 * `children`) and returning {@link SafeHtml}. Use it to annotate view
 * components authored outside of `.tsx` files.
 *
 * @typeParam P - The component's own prop shape.
 */
export type FC<P extends Record<string, unknown> = Record<string, never>> = (
  props: P & { children?: unknown },
) => SafeHtml;

// ── HTML element sets ─────────────────────────────────────────────────────────

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// ── Escaping ──────────────────────────────────────────────────────────────────
// Attribute values and auto-escaped text children both go through `escHtml`,
// imported from helpers/html.ts — the framework's one escaper
// (Bun.escapeHTML underneath).

// ── Child rendering ───────────────────────────────────────────────────────────
//
// The key security boundary:
//   • SafeHtml  → pass through as-is (already rendered by jsx() / safe())
//   • string    → AUTO-ESCAPE (treat as untrusted user data)
//   • number    → convert to string, no escaping needed (numbers are inert)
//   • boolean / null / undefined → render nothing (conditional rendering idiom)
//   • Array     → recurse (children array from jsxs)

function renderChildren(children: unknown): string {
  if (children instanceof SafeHtml) return children.value;
  if (typeof children === "string") return escHtml(children);
  if (typeof children === "number") return String(children);
  if (children === null || children === undefined || children === false || children === true)
    return "";
  if (Array.isArray(children)) return children.map(renderChildren).join("");
  // Fallback: stringify and escape unknown values
  return escHtml(String(children));
}

// ── Attribute rendering ───────────────────────────────────────────────────────

function renderAttrs(props: Record<string, unknown>): string {
  let out = "";
  for (const [key, val] of Object.entries(props)) {
    if (key === "children" || key === "key" || key === "dangerouslySetInnerHTML") continue;
    if (val === undefined || val === null || val === false) continue;
    if (val === true) {
      out += ` ${key}`;
      continue;
    }
    // Map React prop-name conventions to their HTML equivalents.
    const attr = key === "className" ? "class" : key === "htmlFor" ? "for" : key;
    if (typeof val === "string" || typeof val === "number") {
      out += ` ${attr}="${escHtml(String(val))}"`;
    }
  }
  return out;
}

// ── JSX factory ───────────────────────────────────────────────────────────────

/**
 * The JSX factory the TypeScript runtime calls for every element. Renders an
 * intrinsic tag to an HTML string or invokes a component function, always
 * returning {@link SafeHtml}. Not called directly — emitted by the compiler
 * under `@jsxImportSource @zerotal/core`.
 *
 * @internal
 */
export function jsx(
  tag: string | FC<Record<string, unknown>>,
  props: Record<string, unknown> | null,
  _key?: unknown,
): SafeHtml {
  const allProps = props ?? {};
  const { children, dangerouslySetInnerHTML, ...rest } = allProps as Record<string, unknown> & {
    children?: unknown;
    dangerouslySetInnerHTML?: { __html: string };
  };

  if (typeof tag === "function") {
    markViewComponent(tag);
    return tag({ ...rest, children });
  }

  const attrs = renderAttrs(rest);

  if (VOID_ELEMENTS.has(tag)) return new SafeHtml(`<${tag}${attrs}>`);

  // dangerouslySetInnerHTML bypasses child rendering — explicit raw-HTML escape hatch.
  const inner =
    dangerouslySetInnerHTML !== undefined
      ? dangerouslySetInnerHTML.__html
      : renderChildren(children);

  return new SafeHtml(`<${tag}${attrs}>${inner}</${tag}>`);
}

/**
 * Alias of {@link jsx} — the runtime calls it when children is a static array
 * literal. Emitted by the compiler, not called directly.
 * @internal
 */
export const jsxs = jsx;

/**
 * Alias of {@link jsx} used by the compiler in development mode; the same
 * implementation is correct for SSR.
 * @internal
 */
export const jsxDEV = jsx;

// ── Fragment ──────────────────────────────────────────────────────────────────

/**
 * JSX fragment component — renders its children with no wrapper element,
 * concatenating them into a single {@link SafeHtml}. Written as `<>…</>` in JSX.
 *
 * @example
 * ```tsx
 * <>
 *   <li>One</li>
 *   <li>Two</li>
 * </>
 * ```
 */
export function Fragment({ children }: { children?: unknown }): SafeHtml {
  return new SafeHtml(renderChildren(children));
}

/** The type of a component's `children` prop (any JSX-renderable value). */
export type Children = Parameters<typeof Fragment>[0]["children"];
