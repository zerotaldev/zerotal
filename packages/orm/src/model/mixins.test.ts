import { describe, it, expect } from "bun:test";
import { BaseModel } from "./BaseModel.ts";
import { BaseModelWith, type Constructor } from "./mixins.ts";

// Two trivial mixins in the canonical generic form.
const Timestamped = <T extends Constructor>(Base: T) =>
  class extends Base {
    touched = false;
    touch(): this {
      this.touched = true;
      return this;
    }
  };

const Sluggable = <T extends Constructor>(Base: T) =>
  class extends Base {
    slug = "";
    setSlug(s: string): this {
      this.slug = s;
      return this;
    }
  };

describe("BaseModelWith", () => {
  it("composes a single mixin onto BaseModel", () => {
    class Post extends BaseModelWith(Timestamped) {}
    const p = new Post();
    expect(p).toBeInstanceOf(BaseModel);
    expect(p.touch().touched).toBe(true);
  });

  it("composes multiple mixins (all instance members present)", () => {
    class Post extends BaseModelWith(Timestamped, Sluggable) {}
    const p = new Post();
    expect(p).toBeInstanceOf(BaseModel);
    expect(p.touch().touched).toBe(true);
    expect(p.setSlug("hello").slug).toBe("hello");
  });

  it("preserves BaseModel's static surface through the chain", () => {
    class Post extends BaseModelWith(Timestamped, Sluggable) {}
    // Active-Record statics survive composition.
    expect(typeof Post.query).toBe("function");
    expect(typeof Post.addGlobalScope).toBe("function");
    expect(Post.primaryKey).toBe("id");
  });

  it("is equivalent to manual nesting", () => {
    class Composed extends BaseModelWith(Timestamped, Sluggable) {}
    class Nested extends Sluggable(Timestamped(BaseModel)) {}

    const a = new Composed();
    const b = new Nested();
    expect(a.touch().touched).toBe(b.touch().touched);
    expect(a.setSlug("x").slug).toBe(b.setSlug("x").slug);
  });

  it("applies mixins left-to-right", () => {
    const order: string[] = [];
    const A = <T extends Constructor>(Base: T) => {
      order.push("A");
      return class extends Base {};
    };
    const B = <T extends Constructor>(Base: T) => {
      order.push("B");
      return class extends Base {};
    };
    class M extends BaseModelWith(A, B) {}
    void new M();
    expect(order).toEqual(["A", "B"]);
  });
});
