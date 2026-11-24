/**
 * Join class names, dropping anything falsy.
 *
 * Deliberately tiny — this is the only thing the components here need from a
 * class utility, and it keeps the starter free of a runtime dependency. Swap in
 * `clsx` + `tailwind-merge` if you start composing conflicting utilities.
 *
 * @example
 * cn("px-3 py-2", isActive && "bg-accent", className)
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
