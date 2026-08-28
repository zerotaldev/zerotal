/**
 * The helpers that are safe to import from a browser bundle.
 *
 * Every function reachable from this module is pure: no `node:` imports, no `Bun`
 * globals, no config, no container, no request context. Importing it from a
 * component pulls in these functions and nothing else — the framework does not
 * come with them.
 *
 * **Why this exists.** Without it, an app that wants the framework's `pluralize`
 * on a page has two options, and both are bad. Importing `zerotal` into the client
 * bundle drags the server in. Writing a second implementation means maintaining
 * the same rule twice — and the second copy is always the worse one, because the
 * irregulars and the inflect-the-last-word behaviour are exactly what somebody
 * re-deriving it by hand leaves out. `"supplier line"` pluralises to
 * `"supplier lines"`; the naive rule gives `"suppliers line"`.
 *
 * The same argument applies to money. Two formatters that must agree are a bug
 * waiting for a rounding difference, and the person who finds it is the one paying
 * the invoice.
 *
 * @example
 * ```tsx
 * // resources/js/pages/Trips/Index.tsx — a browser bundle
 * import { pluralize, formatMoney } from "zerotal/shared";
 *
 * <p>{trips.length} {pluralize("trip")} — {formatMoney(total, { currency: "ZAR" })}</p>
 * ```
 *
 * @packageDocumentation
 */
export { pluralize, singularize, snakeCase, camelCase, tableNameFor } from "../support/str.ts";
export { Str } from "../helpers/str.ts";
export { formatMoney, formatNumber, formatDate } from "./format.ts";
export type { FormatOptions, MoneyOptions, NumberOptions, DateOptions } from "./format.ts";
