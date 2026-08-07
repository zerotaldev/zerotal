import { describe, test, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { expose, validate } from "./decorators.ts";
import { FlowTest } from "./testing.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

class SignupPage extends Component {
  @expose @validate((rule) => rule.required().min(2).max(50)) name = "";
  @expose @validate((rule) => rule.required().email()) email = "";
  @expose @validate((rule) => rule.required().min(8).confirmed()) password = "";
  @expose password_confirmation = "";

  // A field with a custom required message.
  @expose @validate((rule) => rule.required("Pick a username")) username = "";

  @expose async submit(): Promise<void> {
    await this.validate(); // uses the @validate decorator rules
  }

  @expose async submitExplicit(): Promise<void> {
    await this.validate({
      email: (rule) => rule.required().email(),
    });
  }

  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

describe("@validate chain + this.validate()", () => {
  test("validates all @validate fields and throws on failure", async () => {
    const t = await FlowTest.mount(SignupPage);
    await t.set("name", "A"); // too short
    await t.set("email", "nope"); // not an email
    await t.call("submit");
    t.assertHasErrors("name");
    t.assertHasErrors("email");
    t.assertHasErrors("password"); // required, still empty
  });

  test("passes when every field is valid", async () => {
    const t = await FlowTest.mount(SignupPage);
    await t.set("name", "Ada Lovelace");
    await t.set("email", "ada@example.com");
    await t.set("password", "supersecret");
    await t.set("password_confirmation", "supersecret");
    await t.set("username", "ada");
    await t.call("submit");
    t.assertNoErrors();
  });

  test("confirmed() checks the <field>_confirmation sibling", async () => {
    const t = await FlowTest.mount(SignupPage);
    await t.set("name", "Ada Lovelace");
    await t.set("email", "ada@example.com");
    await t.set("username", "ada");
    await t.set("password", "supersecret");
    await t.set("password_confirmation", "different");
    await t.call("submit");
    t.assertHasErrors("password");
  });

  test("required(message) uses the custom message", async () => {
    const t = await FlowTest.mount(SignupPage);
    await t.call("submit");
    t.assertHasErrors("username", "Pick a username");
  });

  test("explicit builder-map form validates only the given fields", async () => {
    const t = await FlowTest.mount(SignupPage);
    await t.set("email", "bad");
    await t.call("submitExplicit");
    t.assertHasErrors("email");
    // name/password are NOT in the explicit map, so they're not validated here.
    expect(t.errors()["name"]).toBeUndefined();
  });
});

describe("real-time validation (on update, no action)", () => {
  // `update()` simulates a client-driven model change (flow:model.live / $flow.$set),
  // which routes through `_applyClientUpdate` and triggers per-field validation.
  test("updating a field with a @validate rule validates just that field", async () => {
    const t = await FlowTest.mount(SignupPage);
    await t.update("email", "not-an-email"); // a model update, no action call
    t.assertHasErrors("email");
    // Other fields are untouched — no errors leak onto them.
    expect(t.errors()["name"]).toBeUndefined();
    expect(t.errors()["password"]).toBeUndefined();
  });

  test("fixing the value clears the field's error live", async () => {
    const t = await FlowTest.mount(SignupPage);
    await t.update("email", "not-an-email");
    t.assertHasErrors("email");
    await t.update("email", "ada@example.com"); // now valid
    expect(t.errors()["email"]).toBeUndefined();
  });

  test("real-time confirmed() sees the sibling field's current value", async () => {
    const t = await FlowTest.mount(SignupPage);
    await t.update("password_confirmation", "supersecret");
    await t.update("password", "supersecret"); // matches → valid
    expect(t.errors()["password"]).toBeUndefined();
    await t.update("password", "mismatch"); // no longer matches → error
    t.assertHasErrors("password");
  });

  test("a field without a @validate rule is never validated on update", async () => {
    const t = await FlowTest.mount(SignupPage);
    await t.update("password_confirmation", "x"); // no @validate rule
    t.assertNoErrors();
  });
});
