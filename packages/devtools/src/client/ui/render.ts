/**
 * A keyed list reconciler, in about sixty lines and with no dependency.
 *
 * The panel used to redraw `#content` wholesale on every trace, which on the All
 * tab — the one that redraws most, because every request changes it — threw away
 * the scroll position, every open `<details>`, and the caret in the filter box,
 * fifty times a second under load. Keying the rows means an arriving request
 * inserts one node and touches nothing else.
 *
 * Deliberately not a virtual DOM. The panel is bundled on demand and injected
 * into arbitrary apps, so it stays dependency-free and small; a list diff is the
 * only reconciliation any of this needs.
 */

/** Where a reconciler stores each child's identity. */
const KEY_ATTR = "data-k";

/**
 * Make `host`'s element children match `items`, in order, reusing by key.
 *
 * A child whose key survives is moved rather than rebuilt, so anything the
 * browser owns inside it — scroll offset, `<details>` state, an iframe's loaded
 * document, text selection — survives with it.
 *
 * @param host - The element whose children are the list. Must hold nothing else.
 * @param items - The list, in the order it should appear.
 * @param keyOf - A stable identity per item. Two items must never share one.
 * @param create - Build the element for an item seen for the first time.
 * @param update - Bring a reused element up to date. Called for every survivor.
 */
export function reconcile<T>(
  host: HTMLElement,
  items: readonly T[],
  keyOf: (item: T) => string,
  create: (item: T) => HTMLElement,
  update?: (el: HTMLElement, item: T) => void,
): void {
  const existing = new Map<string, HTMLElement>();
  // Anything without a key was not put there by a previous reconcile — an empty
  // state, a message the host wrote directly — so it is not part of the list and
  // has to go, or it lingers above the rows that replaced it.
  const strays: Element[] = [];
  for (const child of Array.from(host.children)) {
    const key = child.getAttribute(KEY_ATTR);
    if (key === null) strays.push(child);
    else existing.set(key, child as HTMLElement);
  }
  for (const stray of strays) stray.remove();

  // Walks forward through the host's children alongside `items`. Anything
  // already in the right place is left untouched, which is what keeps a steady
  // list from generating DOM writes at all.
  let cursor: ChildNode | null = host.firstChild;

  for (const item of items) {
    const key = keyOf(item);
    let el = existing.get(key);
    if (el) {
      existing.delete(key);
      update?.(el, item);
    } else {
      el = create(item);
      el.setAttribute(KEY_ATTR, key);
    }
    if (cursor === el) {
      cursor = el.nextSibling;
    } else {
      host.insertBefore(el, cursor);
    }
  }

  // Whatever the walk did not claim is gone from the list.
  for (const el of existing.values()) el.remove();
}

/**
 * Build an element from a markup string.
 *
 * The tabs are string builders — the shape they render is fixed and a template
 * literal reads far better than twenty `createElement` calls — so the reconciler
 * needs a way back from markup to a node it can key and move.
 */
export function el(html: string): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild as HTMLElement;
}
