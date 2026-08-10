/**
 * Compile-time directive resolution.
 *
 * Maps JSX prop names to their final HTML attribute equivalents.
 * Mirrors PULSE_PROP_MAP in jsx-runtime.ts — kept in sync manually; both are the
 * single source of truth for their respective runtime vs. compile-time roles.
 */

export type DirectiveKind =
  | { kind: "boolean"; attr: string } // showOnLoading → flow:loading  (no value)
  | { kind: "passthrough"; attr: string } // loadingAttr="disabled" → flow:loading.attr="disabled"
  | { kind: "value"; attrs: [string, string] } // value={this.x} → flow:model="x" value="<dynamic>"
  | { kind: "event"; prefix: string } // onClick → flow:click
  | { kind: "passthrough-expr"; attr: string } // confirm={...} → flow:confirm="..."
  | { kind: "text" }; // text={this.x} → flow:text="x" + child injection

/** Directive entries for boolean JSX props (no value → no value in HTML). */
export const BOOLEAN_DIRECTIVES: Record<string, string> = {
  showOnLoading: "flow:loading",
  hideOnLoading: "flow:loading.remove",
  showOnDirty: "flow:dirty",
  hideOnDirty: "flow:dirty.remove",
  navigate: "flow:navigate",
  navigateHover: "flow:navigate.hover",
  navigatePreserveScroll: "flow:navigate.preserve",
  currentExact: "flow:current.exact",
  currentStrict: "flow:current.strict",
  cloak: "flow:cloak",
  ignore: "flow:ignore",
  ignoreSelf: "flow:ignore.self",
  replace: "flow:replace",
  replaceSelf: "flow:replace.self",
  showImportant: "flow:show.important",
  intersectOnce: "flow:intersect.once", // fire onIntersect once, then stop observing
  sortHandle: "flow:sort:handle",
  sortIgnore: "flow:sort:ignore",
  streamReplace: "flow:stream.replace",
  delay: "flow:loading.delay",
  collapse: "x-collapse", // Tier 3: animate x-show height
  transition: "flow:transition", // enter animation on morph (bridge: _triggerEnterTransition)
  showOnOffline: "flow:offline", // shown while the WS connection is down
  hideOnOffline: "flow:offline.remove", // hidden while the WS connection is down
  showOnError: "flow:failed", // shown after an action fails (optimistic failed state)
  hideOnError: "flow:failed.remove", // hidden after an action fails
  autoFocus: "flow:autofocus", // focus this field on mount
  focusOnError: "flow:focus-error", // focus this field after a patch if it becomes invalid
};

/**
 * String-passthrough directives: the prop name maps to a different attribute
 * name but the string value is passed through unchanged.
 * E.g. `loadingAttr="disabled"` → `flow:loading.attr="disabled"`.
 */
export const STRING_DIRECTIVES: Record<string, string> = {
  loadingClass: "flow:loading.class",
  loadingClassRemove: "flow:loading.class.remove",
  loadingAttr: "flow:loading.attr",
  dirtyClass: "flow:dirty.class",
  dirtyClassRemove: "flow:dirty.class.remove",
  dirtyAttr: "flow:dirty.attr",
  current: "flow:current",
  ref: "flow:ref",
  loadingTarget: "flow:target", // scope loading state to specific action(s)
  loadingTargetExcept: "flow:target.except",
  dirtyTarget: "flow:target", // scope dirty state to specific prop(s)
  offlineClass: "flow:offline.class", // class toggled while offline
  offlineClassRemove: "flow:offline.class.remove",
  offlineAttr: "flow:offline.attr", // attribute toggled while offline
  intersectMargin: "flow:intersect.margin", // observer rootMargin, e.g. "200px" (fire before entry)
  intersectThreshold: "flow:intersect.threshold", // "half" | "full" | 0..1
  sortItem: "flow:sort:item", // per-item reorder key (literal keys; dynamic keys use the runtime path)
  sortGroup: "flow:sort:group",
  stream: "flow:stream",
  poll: "flow:poll",
  confirm: "flow:confirm",
  show: "flow:show",
  onInit: "flow:init",
  teleport: "flow:teleport",
  mask: "x-mask", // Tier 3: input masking
  trap: "x-trap", // Tier 3: focus trap (truthy expression)
  anchor: "x-anchor", // Tier 3: position relative to another element
  transition: "flow:transition", // enter/leave preset for show= (e.g. transition="slide-right")
  draft: "flow:draft", // persist an unsubmitted input value to localStorage under this key
};

/** HTML attribute name normalisation (JSX names → HTML names). */
export const ATTR_RENAMES: Record<string, string> = {
  className: "class",
  htmlFor: "for",
};

/** VOID_ELEMENTS that must not have a closing tag. */
export const VOID_ELEMENTS = new Set([
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
