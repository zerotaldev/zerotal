import { describe, test, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { expose } from "./decorators.ts";
import { ErrorMessage } from "./components.ts";
import { FlowTest } from "./testing.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

class Demo extends Component {
  @expose name = "";

  @expose addOne(): void {
    this.errors.add("email", "Invalid email or password.");
  }

  @expose addMap(): void {
    this.errors.add({ email: "Bad email", password: ["Too short", "Needs a number"] });
  }

  @expose clearOne(): void {
    this.errors.add("email", "x");
    this.errors.add("name", "y");
    this.errors.clear("email");
  }

  @expose redirectWithFlash(): unknown {
    return this.redirect("/home", 303).withSuccess("Welcome back.");
  }

  @expose redirectWithError(): unknown {
    return this.redirect("/login").withError("Please sign in.");
  }

  @expose flashChained(): void {
    this.flash("Post deleted")
      .title("Removed")
      .warning()
      .position("top-center")
      .duration(8000)
      .progressBar();
  }

  @expose flashWithOptions(): void {
    this.flash("Saved", {
      type: "success",
      duration: 1500,
      position: "bottom-left",
      dismissible: false,
      icon: "🎉",
    });
  }

  @expose flashSticky(): void {
    this.flash("Maintenance soon").error().noAutoDismiss();
  }

  @expose flashWithAction(): void {
    this.flash("Post deleted")
      .action("Undo", "restorePost", [42], "info")
      .action("Delete forever", "purge", [42], {
        color: "error",
        variant: "solid",
        uppercase: true,
      })
      .onClose("acknowledge");
  }

  @expose restorePost(_id: number): void {}
  @expose purge(_id: number): void {}
  @expose acknowledge(): void {}

  override async render(): Promise<HtmlNode> {
    return { html: `<div>${this.name}</div>` };
  }
}

describe("this.errors.add()", () => {
  test("string signature adds a field error", async () => {
    const t = await FlowTest.mount(Demo);
    await t.call("addOne");
    t.assertHasErrors("email", "Invalid email");
  });

  test("map signature adds multiple fields (and arrays of messages)", async () => {
    const t = await FlowTest.mount(Demo);
    await t.call("addMap");
    t.assertHasErrors("email", "Bad email");
    t.assertHasErrors("password", "Too short");
    expect(t.errors().password).toContain("Needs a number");
  });

  test("clear(field) removes one field's errors", async () => {
    const t = await FlowTest.mount(Demo);
    await t.call("clearOne");
    expect(t.errors().email).toBeUndefined();
    t.assertHasErrors("name");
  });
});

// A page whose render points ErrorMessage at the field VALUE (`for={this.email}`),
// exercising the runtime field-name recovery.
class FieldPage extends Component {
  @expose email = "alice@example.com";

  @expose flagEmail(): void {
    this.errors.add("email", "Invalid email or password.");
  }

  override async render(): Promise<HtmlNode> {
    return ErrorMessage({ for: this.email });
  }
}

describe("ErrorMessage for={this.<field>} runtime resolution", () => {
  test("binds the span to the field's errors (flow:error/flow:show)", async () => {
    const t = await FlowTest.mount(FieldPage);
    expect(t.html()).toContain('flow:error="email"');
    expect(t.html()).toContain('flow:show="errors.email"');
    // After an error is added, it stays bound to the same field.
    await t.call("flagEmail");
    t.assertHasErrors("email", "Invalid email");
    expect(t.html()).toContain('flow:error="email"');
  });
});

describe("this.redirect().with*() chaining", () => {
  test("redirect + withSuccess sets redirect and flashes success", async () => {
    const t = await FlowTest.mount(Demo);
    await t.call("redirectWithFlash");
    t.assertRedirectedTo("/home");
    t.assertFlashed("success", "Welcome back.");
  });

  test("redirect + withError flashes error", async () => {
    const t = await FlowTest.mount(Demo);
    await t.call("redirectWithError");
    t.assertRedirectedTo("/login");
    t.assertFlashed("error", "Please sign in.");
  });
});

describe("this.flash() fluent builder + options", () => {
  test("chained setters mutate the queued payload in place", async () => {
    const t = await FlowTest.mount(Demo);
    await t.call("flashChained");
    const [f] = t.flashes();
    expect(f).toMatchObject({
      message: "Post deleted",
      level: "warning",
      title: "Removed",
      position: "top-center",
      duration: 8000,
      progressBar: true,
    });
  });

  test("options object form maps type→level and carries config", async () => {
    const t = await FlowTest.mount(Demo);
    await t.call("flashWithOptions");
    const [f] = t.flashes();
    expect(f).toMatchObject({
      message: "Saved",
      level: "success",
      duration: 1500,
      position: "bottom-left",
      dismissible: false,
      icon: "🎉",
    });
  });

  test("noAutoDismiss() sets duration to 0", async () => {
    const t = await FlowTest.mount(Demo);
    await t.call("flashSticky");
    const [f] = t.flashes();
    expect(f.level).toBe("error");
    expect(f.duration).toBe(0);
  });

  test("multiple action()s accumulate, with method-by-name + constrained styles", async () => {
    const t = await FlowTest.mount(Demo);
    await t.call("flashWithAction");
    const [f] = t.flashes();
    expect(f.actions).toEqual([
      { label: "Undo", method: "restorePost", args: [42], color: "info" },
      {
        label: "Delete forever",
        method: "purge",
        args: [42],
        color: "error",
        variant: "solid",
        uppercase: true,
      },
    ]);
    expect(f.onClose).toEqual({ method: "acknowledge" });
  });
});
