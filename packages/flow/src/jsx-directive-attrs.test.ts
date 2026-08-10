/**
 * The runtime JSX path must emit the same attribute names the compiler does.
 *
 * A page renders through the compiler's fast path when it can be compiled, and
 * through `jsx()` at runtime when it can't (a branching `render()`, a construct
 * the transform bails on). Both are supported, so a directive that only survives
 * one of them is a prop that works or doesn't depending on how the page happens
 * to be written — with nothing raised either way.
 *
 * That is what `toFlowHtmlAttr()` was doing to the two hyphenated directives: it
 * rewrites `-` to `.` inside a `flow:` attribute, which is right for a
 * hand-written `flow:loading-class` but wrong for a name the map already spells
 * out. `focusOnError` reached the DOM as `flow:focus.error`, and the bridge only
 * ever queries `[flow\:focus-error]`.
 */
import { describe, it, expect } from "bun:test";
import { jsx } from "./jsx-runtime.ts";

const attrs = (props: Record<string, unknown>): string => jsx("input", props).html;

describe("hyphenated directive names survive the runtime path", () => {
  it("emits flow:focus-error, which is the selector the bridge uses", () => {
    // The live bug: focus-on-error worked on a compiled page and silently did
    // nothing on a runtime-rendered one.
    expect(attrs({ focusOnError: true })).toContain("flow:focus-error");
    expect(attrs({ focusOnError: true })).not.toContain("flow:focus.error");
  });

  it("emits flow:sort:group-id as mapped", () => {
    expect(attrs({ sortGroupId: "x" })).toContain("flow:sort:group-id");
  });
});

describe("everything else is unchanged", () => {
  it("keeps dotted modifier names exactly as mapped", () => {
    expect(attrs({ dirtyClassRemove: "x" })).toContain("flow:dirty.class.remove");
    expect(attrs({ loadingTargetExcept: "x" })).toContain("flow:target.except");
    expect(attrs({ navigateHover: true })).toContain("flow:navigate.hover");
    expect(attrs({ navigatePreserveScroll: true })).toContain("flow:navigate.preserve");
  });

  it("keeps single-word names", () => {
    expect(attrs({ autoFocus: true })).toContain("flow:autofocus");
    expect(attrs({ navigate: true })).toContain("flow:navigate");
  });

  it("still rewrites kebab to dots for a hand-written flow: attribute", () => {
    // The rewrite's actual purpose, and the reason it is kept rather than removed:
    // a dot is awkward to type as a JSX attribute name, so kebab is accepted there.
    expect(attrs({ "flow:loading-class": "opacity-50" })).toContain('flow:loading.class="');
  });

  it("leaves non-flow attributes alone", () => {
    expect(attrs({ "data-test-id": "x" })).toContain('data-test-id="x"');
    expect(attrs({ "aria-label": "Name" })).toContain('aria-label="Name"');
  });
});
