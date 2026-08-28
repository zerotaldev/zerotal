/**
 * The boundary between a model and a page prop.
 *
 * Inertia page props are page source. Everything handed to `inertia()` is
 * serialised into the HTML document — or returned as JSON on an XHR visit — and
 * anybody who views source reads all of it. That is not a leak in itself; it is
 * how the protocol works. It becomes a leak because of what the obvious code does:
 *
 * ```ts
 * return inertia("Trips/Show", { trip });   // the first thing anyone writes
 * ```
 *
 * `trip` is a model, and a model serialises the row. Every column. The internal
 * cost, the margin, the note somebody left about the customer — all of it, in the
 * page, on the customer's own screen. Nothing fails, nothing logs, and the page
 * looks right.
 *
 * The ORM already has the answer: `static hidden` and `static visible` are honoured
 * by `toJSON()`, which is what serialises a prop. Declaring the dangerous columns
 * once at the model is strictly better than remembering a projection at every call
 * site. What was missing is anything that says so at the moment it matters.
 *
 * So this warns — in development only, once per model class — when a model reaches
 * page props having declared neither list. Not "you passed a model", which is
 * normal and fine, but "you passed a model that has never said which of its columns
 * are safe to publish". A model with either list declared is silent forever after.
 *
 * @module
 */
import { deployEnv, isDevSurfaceAllowed } from "@zerotal/core";

/** A value that serialises like an ORM model. */
interface ModelLike {
  toJSON(): unknown;
  constructor: { name: string; hidden?: unknown; visible?: unknown };
}

/**
 * Model classes already reported. Keyed by the class itself, so two models with the
 * same name are two findings and a hot path never re-formats a warning nobody
 * needs to read twice.
 */
const _warned = new WeakSet<object>();

/** How deep to look for models inside props. */
const MAX_DEPTH = 4;

/** How many values to look at per level, so a large collection cannot cost the request. */
const MAX_BREADTH = 50;

/**
 * How many fields a value publishes when serialised, or `null` when it is not the
 * kind of thing this check is about.
 *
 * Structural, not `instanceof BaseModel`: `@zerotal/inertia` must not depend on
 * `@zerotal/orm`, and an app can serve Inertia pages with no ORM installed at all.
 * Three conditions together are specific enough — a class instance (not a plain
 * object, which is already a projection), carrying its own `toJSON`, whose
 * `toJSON` returns an object with fields in it.
 *
 * That last one is doing real work. `Date` is a class instance with a `toJSON`,
 * and so are `URL` and the Temporal types; every one of them serialises to a
 * string, and a string has no columns to leak. Requiring an object result is what
 * separates "a row went into the page" from "a timestamp did".
 */
function serialisedFieldCount(value: unknown): number | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype === null || prototype === Object.prototype) return null;
  if (typeof (value as { toJSON?: unknown }).toJSON !== "function") return null;
  let json: unknown;
  try {
    json = (value as ModelLike).toJSON();
  } catch {
    // A model whose serialisation throws — an unloaded relation, most likely —
    // has a problem this check is not the right place to report.
    return null;
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const fields = Object.keys(json).length;
  return fields > 0 ? fields : null;
}

/** Whether a model's class has said anything at all about what is safe to publish. */
function declaresBoundary(model: ModelLike): boolean {
  const { hidden, visible } = model.constructor;
  return (
    (Array.isArray(hidden) && hidden.length > 0) || (Array.isArray(visible) && visible.length > 0)
  );
}

/**
 * The warning text. Names the model, says how much of it is about to be published,
 * and gives the one-line fix rather than a principle.
 */
export function propBoundaryWarning(name: string, columns: number, propKey: string): string {
  return (
    `[inertia] \`${name}\` was passed as the \`${propKey}\` prop and declares neither ` +
    `\`hidden\` nor \`visible\`, so all ${columns} of its serialised fields are written into ` +
    `page source — readable by anyone who views source on this page.\n` +
    `  If that is intended, say so once and this goes quiet:\n` +
    `      static hidden: Columns<${name}>[] = ["cost_cents", "internal_notes"];\n` +
    `      static visible: Columns<${name}>[] = ["id", "title"];   // or an allow-list\n` +
    `  Both are honoured by toJSON(), which is what serialises this prop.`
  );
}

/**
 * Warn about models in page props that have never declared a boundary.
 *
 * Development only, and a no-op everywhere else — it walks the resolved prop tree,
 * which is not work a served request should be doing.
 *
 * @param props - The resolved props, as they will be serialised.
 * @param report - Where to write findings. Injectable for tests.
 */
export function checkPropBoundary(
  props: Record<string, unknown>,
  report: (message: string) => void = (m) => console.warn(m),
): void {
  if (!isDevSurfaceAllowed(deployEnv())) return;

  const visit = (value: unknown, propKey: string, depth: number, seen: WeakSet<object>): void => {
    if (depth > MAX_DEPTH || value === null || typeof value !== "object") return;
    // Props can hold the same model twice, and a loaded relation can point back at
    // its parent. Either would otherwise be walked forever.
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value.slice(0, MAX_BREADTH)) visit(item, propKey, depth + 1, seen);
      return;
    }

    const fields = serialisedFieldCount(value);
    if (fields !== null) {
      const model = value as ModelLike;
      if (!declaresBoundary(model) && !_warned.has(model.constructor)) {
        _warned.add(model.constructor);
        report(propBoundaryWarning(model.constructor.name, fields, propKey));
      }
      return;
    }

    // A plain object — a paginator, a `{ data: [...] }` envelope, a hand-built
    // projection that happens to carry a model on one key.
    for (const nested of Object.values(value).slice(0, MAX_BREADTH)) {
      visit(nested, propKey, depth + 1, seen);
    }
  };

  for (const [key, value] of Object.entries(props)) {
    visit(value, key, 0, new WeakSet<object>());
  }
}

/** Forget every class already reported. @internal For tests. */
export function _resetPropBoundaryWarnings(classes: object[]): void {
  for (const cls of classes) _warned.delete(cls);
}
