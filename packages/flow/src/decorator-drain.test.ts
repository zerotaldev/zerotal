/**
 * Which class a buffered field registration belongs to.
 *
 * Field decorators cannot see their own class (Bun mis-compiles standard field
 * decorators, so the registration is buffered in the decorator body and drained
 * later — see `_drainFields`). Draining therefore has to work out which buffered
 * entries belong to the class being read, and getting that wrong is silent: the
 * class receives another class's decorator and never receives its own.
 *
 * Both cases below were live. The first shipped as a Linux-only CI failure in
 * `child-keys.test.ts` — `@reactive count` never registered, so `count` was folded
 * into the child id and every parent-pushed change remounted the child. It passed
 * on one machine and failed on another purely on which files had run first.
 */
import { describe, it, expect } from "bun:test";
import { Component } from "./Component.ts";
import type { HtmlNode } from "./jsx-runtime.ts";
import { expose, locked, reactive } from "./decorators.ts";
import { getReactiveProps, getExposedProps } from "./decorators.ts";
import type { Constructor } from "./mixins.ts";

// A component that declares `count` and is NEVER read. Its registration stays in
// the buffer for the life of the process — which is the normal state of affairs in
// any codebase where a component is defined in a module that something imports for
// another reason.
class UnreadNamesake extends Component {
  @expose count = 0;
  override async render(): Promise<HtmlNode> {
    return { html: "" };
  }
}
void UnreadNamesake;

// Declared BETWEEN the two `count`s on purpose. Adjacent same-name entries are
// merged by the drain's "multiple decorators on one field" rule, which is what hid
// this bug from a simpler test — the two entries have to be separated to collide.
class Separator extends Component {
  @expose settingKey = "";
  override async render(): Promise<HtmlNode> {
    return { html: "" };
  }
}
void Separator;

class RealCounter extends Component {
  @reactive count = 0;
  override async render(): Promise<HtmlNode> {
    return { html: "" };
  }
}

// A mixin whose field the subclass inherits: `page` is on a `Paged` instance but is
// not declared by it. Written in the shape mixin authors use — see `Pagination`.
function Paginated<TBase extends Constructor<Component>>(Base: TBase) {
  abstract class WithPage extends Base {
    @expose @locked page = 1;
  }
  return WithPage;
}

class Paged extends Paginated(Component) {
  @locked rows: number[] = [1, 2, 3];
  override async render(): Promise<HtmlNode> {
    return { html: "" };
  }
}

describe("decorator drain — which class an entry belongs to", () => {
  it("does not let an unread class's namesake entry be claimed by another class", () => {
    // Was `[]`: the older, never-drained `@expose count` was claimed instead, so
    // RealCounter got `expose` and never got `reactive`.
    expect([...getReactiveProps(RealCounter.prototype)]).toEqual(["count"]);
  });

  it("matches a subclass on the fields it declares, not the ones it inherits", () => {
    // `page` is inherited, so a leftover `[page, page]` block from another
    // application of the mixin must not out-score this class's own `[rows]`.
    expect(getExposedProps(new Paged()).has("rows")).toBe(true);
  });
});
