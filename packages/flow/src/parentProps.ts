// Signing for the values a parent pushes into a child's `@reactive` props.
//
// A parent re-renders with new values for its child's `@reactive` props and carries them on the
// child's root as `data-flow-props`. The browser forwards them to the child with the `$props`
// built-in, because the child's own render is what has to run. The browser may not write a
// `@reactive` prop itself (`$set` refuses one that is not also `@modelable`), so what it forwards
// must be what the parent sent: the JSON is signed here, bound to the child's id, and checked
// before anything is written.
import { safeEqual, hmacHex } from "@zerotal/core";

function _appKey(): string {
  const key = Bun.env["APP_KEY"];
  if (!key) throw new Error("[Flow] APP_KEY is not set. Signing child props requires APP_KEY.");
  return key;
}

function _payload(childId: string, json: string): string {
  return `flow-props\0${childId}\0${json}`;
}

/**
 * Sign the `data-flow-props` JSON a parent renders onto a child, for that child only.
 *
 * @param childId - The child's component id, the one its snapshot carries.
 * @param json - The exact JSON string written into `data-flow-props`.
 * @returns The signature, for `data-flow-props-sig`.
 * @internal
 */
export function _signParentProps(childId: string, json: string): string {
  return hmacHex(_payload(childId, json), _appKey());
}

/**
 * Whether `json` is what a parent signed for `childId`.
 *
 * @internal
 */
export function _verifyParentProps(childId: string, json: string, sig: unknown): boolean {
  if (typeof sig !== "string" || sig === "") return false;
  return safeEqual(_signParentProps(childId, json), sig);
}
