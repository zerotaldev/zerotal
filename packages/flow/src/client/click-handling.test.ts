/**
 * Two bugs in the delegated click listener, both silent.
 *
 * 1. `preventDefault()` was unconditional. That cancels the *activation behaviour* of
 *    whatever it sits on, so a radio or checkbox carrying `onClick` never became
 *    checked — and no handler could compensate, because the browser restores the
 *    control's pre-click checkedness after listeners run. `onClick` and a form control
 *    were mutually exclusive, and nothing said so.
 *
 * 2. Modifiers were emitted into the attribute *name* (`flow:click.stop`) but looked up
 *    with an exact `[flow\:click]` selector, so every handler carrying a modifier was
 *    invisible to the bridge and did nothing whatsoever.
 */
import { describe, it, expect } from "bun:test";
import { _findHandler, _shouldPreventClickDefault } from "./bridge.ts";

/** A minimal element stand-in: this file runs without a DOM. */
function el(tagName: string, attrs: Record<string, string> = {}, parent: unknown = null): Element {
  return {
    tagName,
    parentElement: parent,
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    getAttribute: (n: string) => attrs[n] ?? null,
  } as unknown as Element;
}

describe("which elements have their default action cancelled", () => {
  const none = new Set<string>();

  it("cancels navigation on an anchor", () => {
    expect(_shouldPreventClickDefault(el("A", { href: "/x" }), none)).toBe(true);
  });

  it("cancels submission on a submit button, including the implicit default type", () => {
    expect(_shouldPreventClickDefault(el("BUTTON", { type: "submit" }), none)).toBe(true);
    expect(_shouldPreventClickDefault(el("BUTTON"), none)).toBe(true);
  });

  it("leaves a plain button alone", () => {
    expect(_shouldPreventClickDefault(el("BUTTON", { type: "button" }), none)).toBe(false);
  });

  it("leaves a radio and a checkbox to become checked", () => {
    expect(_shouldPreventClickDefault(el("INPUT", { type: "radio" }), none)).toBe(false);
    expect(_shouldPreventClickDefault(el("INPUT", { type: "checkbox" }), none)).toBe(false);
  });

  it("still cancels a submit input", () => {
    expect(_shouldPreventClickDefault(el("INPUT", { type: "submit" }), none)).toBe(true);
  });

  it("honours .prevent anywhere and .passive everywhere", () => {
    expect(_shouldPreventClickDefault(el("INPUT", { type: "radio" }), new Set(["prevent"]))).toBe(
      true,
    );
    expect(_shouldPreventClickDefault(el("A", { href: "/x" }), new Set(["passive"]))).toBe(false);
  });

  it("does not depend on instanceof, so a cross-document element still resolves", () => {
    // `instanceof HTMLAnchorElement` fails for an element adopted from an iframe or a
    // template; taking the wrong branch there is the bug this guards.
    expect(_shouldPreventClickDefault(el("a", { href: "/x" }), none)).toBe(true);
  });
});

describe("finding a handler with modifiers", () => {
  it("finds a bare flow:click", () => {
    const found = _findHandler(el("BUTTON", { "flow:click": "save" }), "click");
    expect(found?.value).toBe("save");
    expect(found?.modifiers.size).toBe(0);
  });

  it("finds a handler whose modifiers are in the attribute name", () => {
    const found = _findHandler(el("BUTTON", { "flow:click.stop": "save" }), "click");
    expect(found?.value).toBe("save");
    expect(found?.modifiers.has("stop")).toBe(true);
  });

  it("reads several modifiers", () => {
    const found = _findHandler(el("BUTTON", { "flow:click.stop.prevent": "save" }), "click");
    expect([...(found?.modifiers ?? [])].sort()).toEqual(["prevent", "stop"]);
  });

  it("walks up to an ancestor handler, as event delegation requires", () => {
    const button = el("SPAN", {}, el("BUTTON", { "flow:click": "save" }));
    expect(_findHandler(button, "click")?.value).toBe("save");
  });

  it("ignores a different event's handler", () => {
    expect(_findHandler(el("BUTTON", { "flow:blur": "save" }), "click")).toBeNull();
  });

  it("does not match a prefix that merely starts the same", () => {
    expect(_findHandler(el("BUTTON", { "flow:clickable": "save" }), "click")).toBeNull();
  });

  it("returns null when nothing in the chain handles the event", () => {
    expect(_findHandler(el("SPAN", {}, el("DIV")), "click")).toBeNull();
  });
});
