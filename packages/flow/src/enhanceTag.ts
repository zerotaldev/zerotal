/**
 * The one line an app's layout needs for `<form data-enhance>` to work.
 *
 * A helper rather than a documented string, for the reason a sibling feature
 * already learned the hard way: a resource nothing links is a resource nobody
 * discovers is missing. A page whose layout forgot the tag does not fail — the
 * forms simply post the way they always did, and the enhancement is silently
 * absent on exactly the pages it was added for.
 *
 * @module
 */

/** The path `FlowProvider` serves the enhancement bundle at. */
export const FLOW_ENHANCE_PATH = "/__flow/enhance.js";

/**
 * A `<script>` tag loading the plain-form enhancement.
 *
 * Put it in the layout that renders your non-Flow pages. Flow pages already get
 * `/__flow/runtime.js`, which does not include this — the two are separate because
 * the enhancement exists for pages that have no Flow component to run a runtime.
 *
 * `defer` so it never blocks the parse, and the listener is delegated on
 * `document`, so a form that appears later is picked up without re-running
 * anything.
 *
 * @example
 * ```tsx
 * <head>
 *   {flowEnhanceTag()}
 * </head>
 * ```
 */
export function flowEnhanceTag(): string {
  return `<script src="${FLOW_ENHANCE_PATH}" defer></script>`;
}
