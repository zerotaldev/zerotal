/**
 * Build the `strings` argument for a Bun SQL tagged-template call from plain strings.
 *
 * Bun's `sql` function wants what the language hands a tag: a frozen array whose `raw`
 * is a property you cannot see when you enumerate it. `Object.assign(parts, { raw: parts })`
 * makes the property enumerable, and Bun 1.4.4 refuses that with "has an enumerable 'raw'
 * property, so it is not a template object" — every statement built from a runtime-assembled
 * string failed, which is nearly everything the ORM sends. `defineProperty` leaves `raw`
 * non-enumerable, as a real template object has it.
 *
 * Copies its input, so the caller's array is neither frozen nor given a `raw`.
 *
 * @internal Shared by the ORM and by the packages that issue SQL of their own.
 */
export function _templateStrings(parts: readonly string[]): TemplateStringsArray {
  const strings = [...parts];
  Object.defineProperty(strings, "raw", { value: strings });
  return Object.freeze(strings) as TemplateStringsArray;
}
