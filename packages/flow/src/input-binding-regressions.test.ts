/**
 * Regressions for the input-binding failures found building a real app on 1.0.4.
 *
 * All three shared a failure mode: the page rendered, the click registered, and the
 * value reaching the server was wrong or absent — with nothing thrown anywhere. They
 * are grouped here because the fixes interlock: the runtime resolver no longer loses a
 * binding to a sibling prop, radios no longer acquire one by coincidence, and
 * `bind(key, optionValue)` is the explicit way to bind the group that replaces it.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { expose } from "./decorators.ts";
import { jsx } from "./jsx-runtime.ts";
import { FlowTest } from "./testing.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

// ── A reactive sibling prop must not suppress the value binding ────────────────
// `value={this.destination} disabled={this.notSureWhere}` rendered with no
// flow:model at all: the single-slot getter capture ends on `notSureWhere`, the
// freshness check fails, and the resolver silently gave up. The field then accepted
// typing and nothing typed into it ever reached the server.

describe("value binding with a reactive sibling attribute", () => {
  it("keeps flow:model when a later prop reads another exposed property", async () => {
    class DisabledSiblingPage extends Component {
      @expose destination = "Cape Town";
      @expose notSureWhere = false;

      override async render() {
        return jsx("input", { value: this.destination, disabled: this.notSureWhere });
      }
    }

    const t = await FlowTest.mount(DisabledSiblingPage);
    const html = t.html();

    expect(html).toContain('flow:model="destination"');
    expect(html).toContain('value="Cape Town"');
  });

  it("binds the right property when several reactive props sit on one element", async () => {
    class ManyPropsPage extends Component {
      // Not `title` — Component owns that name for the page title.
      @expose heading = "Trip plan";
      @expose busy = false;
      @expose tone = "accent";

      override async render() {
        return jsx("input", {
          value: this.heading,
          disabled: this.busy,
          class: "field " + this.tone,
        });
      }
    }

    const t = await FlowTest.mount(ManyPropsPage);
    const html = t.html();

    expect(html).toContain('flow:model="heading"');
    expect(html).not.toContain('flow:model="busy"');
    expect(html).not.toContain('flow:model="tone"');
  });

  it("still refuses to bind a literal value that coincidentally equals state", async () => {
    // The inference must key off a real `this.` read, not value equality — otherwise a
    // hardcoded value silently becomes a two-way binding for an unrelated property.
    class LiteralPage extends Component {
      @expose mode = "CUSTOM";

      override async render() {
        return jsx("div", {
          children: [
            jsx("input", { value: "CUSTOM", name: "decoy" }),
            jsx("span", { class: "m-" + this.mode }),
          ],
        });
      }
    }

    const t = await FlowTest.mount(LiteralPage);

    expect(t.html()).not.toContain("flow:model");
  });
});

// ── Radios never infer a binding ──────────────────────────────────────────────
// In a group rendered from a .map(), value-identity inference hit exactly one option —
// whichever was selected — so that single radio claimed the group's model and
// overwrote the user's choice on every flush.

describe("radio groups", () => {
  class RadioPage extends Component {
    @expose type = "ROUTE";

    override async render() {
      return jsx("div", {
        children: ["CUSTOM", "ROUTE", "TEAMS"].map((v) =>
          jsx("input", {
            type: "radio",
            name: "trip-type",
            value: v,
            checked: this.type === v,
          }),
        ),
      });
    }
  }

  it("does not inject flow:model onto the selected option", async () => {
    const t = await FlowTest.mount(RadioPage);
    const html = t.html();

    expect(html).not.toContain("flow:model");
    // The option identifiers survive intact.
    expect(html).toContain('value="CUSTOM"');
    expect(html).toContain('value="ROUTE"');
    expect(html).toContain('value="TEAMS"');
  });

  it("marks only the selected radio checked", async () => {
    const t = await FlowTest.mount(RadioPage);
    const html = t.html();

    expect(html.match(/checked/g) ?? []).toHaveLength(1);
  });

  it("binds a group explicitly through bind(key, optionValue)", async () => {
    class BoundRadioPage extends Component {
      @expose type = "TEAMS";

      override async render() {
        return jsx("div", {
          children: ["CUSTOM", "ROUTE", "TEAMS"].map((v) =>
            jsx("input", { type: "radio", name: "trip-type", ...this.bind("type", v) }),
          ),
        });
      }
    }

    const t = await FlowTest.mount(BoundRadioPage);
    const html = t.html();

    // Every option carries the same model key — the group is bound as a unit.
    expect(html.match(/flow:model="type"/g) ?? []).toHaveLength(3);
    expect(html).toContain('value="CUSTOM"');
    expect(html).toContain('value="TEAMS"');
    // Only the current value is checked.
    expect(html.match(/checked/g) ?? []).toHaveLength(1);
  });

  it("bind() without an option value keeps the plain text-input shape", async () => {
    class TextPage extends Component {
      @expose name = "Ada";
      override async render() {
        return jsx("input", { ...this.bind("name") });
      }
    }

    const t = await FlowTest.mount(TextPage);
    const html = t.html();

    expect(html).toContain('flow:model="name"');
    expect(html).toContain('value="Ada"');
    expect(html).not.toContain("checked");
  });
});
