import { describe, it, expect } from "bun:test";
import { Model, BaseModel } from "./BaseModel.ts";
import { type Constructor } from "./mixins.ts";

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

describe("Model.using", () => {
  it("composes a single mixin onto Model", () => {
    class Post extends Model.using(Timestamped) {}
    const p = new Post();
    expect(p).toBeInstanceOf(BaseModel);
    expect(p.touch().touched).toBe(true);
  });

  it("composes multiple mixins (all instance members present)", () => {
    class Post extends Model.using(Timestamped, Sluggable) {}
    const p = new Post();
    expect(p).toBeInstanceOf(BaseModel);
    expect(p.touch().touched).toBe(true);
    expect(p.setSlug("hello").slug).toBe("hello");
  });

  it("preserves Model's static surface through the chain", () => {
    class Post extends Model.using(Timestamped, Sluggable) {}
    // Active-Record statics survive composition.
    expect(typeof Post.query).toBe("function");
    expect(typeof Post.addGlobalScope).toBe("function");
    expect(Post.primaryKey).toBe("id");
  });

  it("is equivalent to manual nesting", () => {
    class Composed extends Model.using(Timestamped, Sluggable) {}
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
    class M extends Model.using(A, B) {}
    void new M();
    expect(order).toEqual(["A", "B"]);
  });

  it("composes onto an intermediate model base, keeping it in the chain", () => {
    // `using` folds onto its receiver, not onto a hardcoded BaseModel — so an app-level
    // base model can carry mixins without being flattened out of the prototype chain.
    class AppModel extends Model {
      static override primaryKey = "uuid";
      auditTrail(): string {
        return "audited";
      }
    }

    class Invoice extends AppModel.using(Timestamped, Sluggable) {}

    const i = new Invoice();
    expect(i).toBeInstanceOf(AppModel); // the intermediate base survives
    expect(i).toBeInstanceOf(BaseModel);
    expect(i.auditTrail()).toBe("audited"); // intermediate-base members
    expect(i.touch().touched).toBe(true); // mixin members
    expect(i.setSlug("inv-1").slug).toBe("inv-1");
    expect(Invoice.primaryKey).toBe("uuid"); // intermediate-base statics, not BaseModel's
    expect(typeof Invoice.query).toBe("function"); // root statics still flow through
  });

  it("chains past the overload set — the composed class carries `using` itself", () => {
    class Post extends Model.using(Timestamped).using(Sluggable) {}
    const p = new Post();
    expect(p).toBeInstanceOf(BaseModel);
    expect(p.touch().touched).toBe(true);
    expect(p.setSlug("x").slug).toBe("x");
    expect(typeof Post.query).toBe("function");
  });

  it("carries mixin statics through to the composed class", () => {
    const Publishable = <T extends Constructor>(Base: T) =>
      class extends Base {
        static publishedScope = "published_at IS NOT NULL";
      };

    class Article extends Model.using(Publishable) {}
    expect(Article.publishedScope).toBe("published_at IS NOT NULL");
    expect(typeof Article.query).toBe("function");
  });

  it("`Model` and `BaseModel` are the same class object", () => {
    expect(Model).toBe(BaseModel);
  });
});
