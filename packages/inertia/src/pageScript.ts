/**
 * The `<script data-page>` tag the Inertia client boots from, and the root it
 * mounts into.
 *
 * Inertia v3 reads the initial page from
 * `script[data-page="app"][type="application/json"]` — a script tag rather than an
 * attribute on the root div, so a large page object does not have to survive
 * attribute escaping. This module owns that markup so the three places that emit
 * it (`inertia()`, `inertiaStream()`, and the `/__ssr` endpoint) cannot drift
 * apart, which is how one of them ends up with a shape the client cannot read.
 *
 * @module
 */

/** The element id the Inertia client mounts into, and the `data-page` key it looks up. */
export const APP_ID = "app";

/**
 * Serialise a page object for embedding in a `<script>` block.
 *
 * `JSON.stringify` alone is not safe here: the payload is arbitrary application
 * data, and a string containing `</script>` ends the block early — everything
 * after it is parsed as HTML. Escaping `<`, `>`, `&` and `/` to their `\uXXXX`
 * forms keeps the JSON valid (JSON.parse decodes them) while leaving nothing in
 * the output a parser can treat as markup.
 *
 * @param page - The Inertia page object.
 * @returns JSON with every character that could break out of a script block escaped.
 */
export function serialisePage(page: unknown): string {
  return JSON.stringify(page)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\//g, "\\/");
}

/**
 * The `<script data-page>` tag carrying the page object.
 *
 * @param page - The Inertia page object.
 */
export function pageScript(page: unknown): string {
  return `<script type="application/json" data-page="${APP_ID}">${serialisePage(page)}</script>`;
}

/**
 * The opening tag of the mount root.
 *
 * `data-server-rendered` is the flag Inertia's client checks to decide between
 * hydrating the markup already on the page and throwing it away to render from
 * scratch. It is set only when the server actually rendered the component — on an
 * empty root it would tell the client to hydrate nothing, which React reports as a
 * mismatch on every page.
 *
 * @param serverRendered - Whether the root contains server-rendered markup.
 */
export function rootOpen(serverRendered: boolean): string {
  return serverRendered
    ? `<div data-server-rendered="true" id="${APP_ID}">`
    : `<div id="${APP_ID}">`;
}

/** The closing tag of the mount root. */
export const ROOT_CLOSE = "</div>";
