// Regression cover for method/getter decorator registration across inheritance.
//
// Bun 1.3.x does not reliably run a method decorator's `addInitializer` callbacks: when a
// SUBCLASS declares a decorated field, the base class's method initializers never run at all.
// Every `@expose`d action on a shared page base then vanished from the allowlist, and because
// the un-@exposed action check is fatal, a legitimate action was rejected at runtime.
//
// The registries are now populated by scanning the prototype chain for tagged members
// (see `_scanProto` in decorators.ts), so these shapes must all hold — and must keep holding
// if the `addInitializer` fallback is ever removed.

import { describe, it, expect } from "bun:test";
import { Component } from "./Component.ts";
import {
  expose,
  computed,
  task,
  renderless,
  on,
  getExposedMethods,
  getTaskMethods,
  getRenderlessMethods,
  getListeners,
  getComputedKeys,
} from "./decorators.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

async function html(): Promise<HtmlNode> {
  return { html: "<div></div>" };
}

describe("@expose method registration through inheritance", () => {
  it("survives a subclass declaring an @expose field (the regression)", () => {
    abstract class Base extends Component {
      @expose breadcrumb = "admin";
      @expose guard(): string {
        return "allowed";
      }
    }
    class Sub extends Base {
      @expose heading = "Dashboard"; // ← this used to wipe `guard` from the allowlist
      override render = html;
    }

    new Sub();
    expect(getExposedMethods(Sub).has("guard")).toBe(true);
  });

  it("registers without the class ever being constructed", () => {
    abstract class Base extends Component {
      @expose act(): void {}
    }
    class Sub extends Base {
      @expose field = 1;
      override render = html;
    }

    // No `new Sub()` anywhere — the prototype scan does not need an instance.
    expect(getExposedMethods(Sub).has("act")).toBe(true);
  });

  it("collects the base's and the subclass's own methods together", () => {
    abstract class Base extends Component {
      @expose fromBase(): void {}
    }
    class Sub extends Base {
      @expose field = 1;
      @expose fromSub(): void {}
      override render = html;
    }

    const methods = getExposedMethods(Sub);
    expect(methods.has("fromBase")).toBe(true);
    expect(methods.has("fromSub")).toBe(true);
  });

  it("does not leak a base's tag onto an unrelated override", () => {
    abstract class Base extends Component {
      @expose shared(): string {
        return "base";
      }
    }
    class Sub extends Base {
      // Overrides the name but is NOT decorated — it must not inherit the base's tag.
      override shared(): string {
        return "sub";
      }
      override render = html;
    }

    // The base still declares it, so the name stays exposed via the chain …
    expect(getExposedMethods(Sub).has("shared")).toBe(true);
    // … but the undecorated override itself carries no tag of its own.
    const own = Object.getOwnPropertyDescriptor(Sub.prototype, "shared");
    expect(typeof own?.value).toBe("function");
    expect(new Sub().shared()).toBe("sub");
  });

  it("keeps sibling subclasses independent", () => {
    abstract class Base extends Component {
      @expose common(): void {}
    }
    class A extends Base {
      @expose onlyA(): void {}
      override render = html;
    }
    class B extends Base {
      @expose onlyB(): void {}
      override render = html;
    }

    expect(getExposedMethods(A).has("common")).toBe(true);
    expect(getExposedMethods(B).has("common")).toBe(true);
    expect(getExposedMethods(A).has("onlyA")).toBe(true);
    expect(getExposedMethods(A).has("onlyB")).toBe(false); // no cross-talk
    expect(getExposedMethods(B).has("onlyB")).toBe(true);
    expect(getExposedMethods(B).has("onlyA")).toBe(false);
  });
});

describe("the other method/getter decorators inherit the same way", () => {
  it("@task registers on a base and implies @expose", () => {
    abstract class Base extends Component {
      @task async work(): Promise<void> {}
    }
    class Sub extends Base {
      @expose field = 1;
      override render = html;
    }

    expect(getTaskMethods(Sub).has("work")).toBe(true);
    expect(getExposedMethods(Sub).has("work")).toBe(true);
  });

  it("@renderless registers on a base", () => {
    abstract class Base extends Component {
      @expose @renderless track(): void {}
    }
    class Sub extends Base {
      @expose field = 1;
      override render = html;
    }

    expect(getRenderlessMethods(Sub).has("track")).toBe(true);
    expect(getExposedMethods(Sub).has("track")).toBe(true);
  });

  it("@on registers its event mapping on a base and implies @expose", () => {
    abstract class Base extends Component {
      @on("post.created") handlePost(): void {}
    }
    class Sub extends Base {
      @expose field = 1;
      override render = html;
    }

    expect(getListeners(Sub).get("post.created")).toBe("handlePost");
    expect(getExposedMethods(Sub).has("handlePost")).toBe(true);
  });

  it("@computed registers on a base", () => {
    abstract class Base extends Component {
      @computed get total(): number {
        return 42;
      }
    }
    class Sub extends Base {
      @expose field = 1;
      override render = html;
    }

    const s = new Sub();
    expect(getComputedKeys(s).has("total")).toBe(true);
    expect(s.total).toBe(42);
  });
});
