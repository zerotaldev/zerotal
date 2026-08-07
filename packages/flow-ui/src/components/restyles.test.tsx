/** @jsxImportSource @zerotal/flow */
import { describe, it, expect } from "bun:test";
import { Switch } from "./Switch.tsx";
import { Checkbox } from "./Checkbox.tsx";
import { Select } from "./Select.tsx";
import { RadioGroup } from "./RadioGroup.tsx";
import { Dialog } from "./Dialog.tsx";

// Switch/Checkbox/Select/RadioGroup resolve their `bind` to an @expose prop name,
// which needs a render context. When called bare (no context) they render unbound
// but still emit their structural classes/markup — enough to assert theming here.

describe("<Switch> (styled)", () => {
  it("renders the headless switch with token track + knob classes", () => {
    const { html } = Switch({ bind: true });
    expect(html).toContain('role="switch"');
    expect(html).toContain("flow-switch");
    expect(html).toContain("data-checked:bg-primary");
    expect(html).toContain("group-data-checked:translate-x-4"); // the knob
  });
});

describe("<Checkbox> (styled)", () => {
  it("renders the headless checkbox with token classes and a check glyph", () => {
    const { html } = Checkbox({ bind: false });
    expect(html).toContain('role="checkbox"');
    expect(html).toContain("data-checked:bg-primary");
    expect(html).toContain("<svg");
  });
});

describe("<Select> (styled)", () => {
  it("renders a native select with token classes and options", () => {
    const { html } = Select({
      bind: "ca",
      options: [
        { label: "Canada", value: "ca" },
        { label: "Japan", value: "jp" },
      ],
    });
    expect(html).toStartWith("<select");
    expect(html).toContain("border-input");
    expect(html).toContain("focus-visible:ring-ring");
    expect(html).toContain("<option");
    expect(html).toContain(">Canada</option>");
  });
});

describe("<RadioGroup> (styled)", () => {
  it("renders a radiogroup with token option classes", () => {
    const { html } = RadioGroup({
      bind: "pro",
      options: [
        { label: "Free", value: "free" },
        { label: "Pro", value: "pro" },
      ],
    });
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain("data-[checked]:bg-primary");
  });
});

describe("<Dialog>", () => {
  it("renders a token-themed dialog (hidden when show is false)", () => {
    const { html } = Dialog({ show: false, title: "Add contact", children: "body" });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("bg-background");
    expect(html).toContain("text-foreground");
    expect(html).toContain("border-border");
    expect(html).toContain(">Add contact</h2>");
    expect(html).toContain("display: none"); // hidden because show=false
    expect(html).not.toContain("bg-gray-900"); // proves it's not the old Modal palette
  });

  it("emits a close button and backdrop when closable (default)", () => {
    const { html } = Dialog({ show: true, title: "T", children: "x" });
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("bg-black/50"); // backdrop
    expect(html).not.toContain("display: none"); // open
  });

  it("omits the close button when closable=false", () => {
    const { html } = Dialog({ show: true, closable: false, title: "T", children: "x" });
    expect(html).not.toContain('aria-label="Close"');
  });
});
