/**
 * `Component`'s own members are reserved: a page property that collides with one is a
 * type error. That is caught at compile time and the message is specific, so the cost is
 * not the failure but the surprise — `title` is an obvious name for a field on a row
 * representing a media item, a guide or a review, and it is taken by the page-title
 * accessor. There was no list to check.
 *
 * This pins the set so the documented list in docs/flow/index.md cannot drift silently:
 * adding a public member to the base class is a deliberate act that takes a name away
 * from every application, and it should not happen by accident.
 */
import { describe, it, expect } from "bun:test";
import { Component } from "./Component.ts";

/** Public (non-underscore) members on the Component prototype. */
function reservedMembers(): string[] {
  return Object.getOwnPropertyNames(Component.prototype)
    .filter((name) => name !== "constructor" && !name.startsWith("_"))
    .sort();
}

const DOCUMENTED = [
  "$",
  "$refresh",
  "$set",
  "addError",
  "bind",
  "cancelled",
  "child",
  "clearDurable",
  "client",
  "currentUrl",
  "dispatch",
  "dispatchSelf",
  "dispatchTo",
  "download",
  "errors",
  "flash",
  "hasSlot",
  "layout",
  "navigateCurrent",
  "onBoot",
  "onDehydrate",
  "onError",
  "onHydrate",
  "onMount",
  "onRendered",
  "onRendering",
  "onUpdate",
  "onUpdated",
  "onUpdating",
  "placeholder",
  "redirect",
  "redirectIntended",
  "redirectRoute",
  "refresh",
  "resetValidation",
  "signal",
  "slot",
  "stream",
  "title",
  "validate",
].sort();

describe("Component reserved member names", () => {
  it("matches the documented list", () => {
    // If this fails, a public member was added to or removed from Component. Update the
    // table in docs/flow/index.md — every name here is one an application cannot use.
    expect(reservedMembers()).toEqual(DOCUMENTED);
  });

  it("includes the one that actually catches people", () => {
    expect(reservedMembers()).toContain("title");
  });

  it("keeps framework internals underscore-prefixed", () => {
    const leaked = Object.getOwnPropertyNames(Component.prototype).filter((n) =>
      n.startsWith("__"),
    );

    expect(leaked).toEqual([]);
  });
});
