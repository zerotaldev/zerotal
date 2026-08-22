import { describe, it, expect } from "bun:test";
import {
  Switch,
  Disclosure,
  Accordion,
  Popover,
  Checkbox,
  Select,
  RadioGroup,
  Listbox,
  Combobox,
  Field,
  Fieldset,
  Label,
  Description,
} from "./headless.ts";
import { Modal, FileUpload, Drawer } from "./components.ts";
import { _renderFlowPage, jsx } from "./jsx-runtime.ts";
import { expose } from "./decorators.ts";

describe("<Switch>", () => {
  it("binds to an @expose boolean and toggles via $set", async () => {
    class P {
      @expose enabled = true;
      render() {
        return Switch({ bind: this.enabled, class: "mine" });
      }
    }
    const p = new P();
    const html = await _renderFlowPage(p as any, () => Promise.resolve(p.render()));
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("data-checked"); // on-state SSR attr
    // Reactivity is driven imperatively by the bridge via flow:bind:attr (avoids the
    // Firefox nested-Proxy :attr issue), not an Alpine :aria-checked binding.
    expect(html).toContain("flow:bind:attr=");
    expect(html).toContain("aria-checked");
    expect(html).toContain("enabled");
    expect(html).toContain("x-on:click=\"$flow.$set('enabled', !$flow.enabled)\"");
    expect(html).toContain("flow-switch group mine"); // group + class passthrough
  });
});

describe("<Disclosure>", () => {
  it("wires aria-expanded/controls and exposes data-open", () => {
    const n = Disclosure({ label: "More", children: "Panel body", defaultOpen: true });
    expect(n.html).toContain('x-data="{ open: true }"');
    expect(n.html).toContain(':aria-expanded="open"');
    expect(n.html).toContain("$id('flow-disclosure')");
    expect(n.html).toContain(":data-open=\"open ? '' : null\"");
    expect(n.html).toContain("More");
    expect(n.html).toContain("Panel body");
  });
});

describe("<Accordion>", () => {
  it("single-open by default; multiple uses an open-map", () => {
    const single = Accordion({
      items: [
        { label: "A", content: "AA" },
        { label: "B", content: "BB" },
      ],
    });
    expect(single.html).toContain('x-data="{ active: -1 }"');
    expect(single.html).toContain('x-on:click="active = active === 1 ? -1 : 1"');
    expect(single.html).toContain('x-show="active === 0"');
    expect(single.html).toContain("AA");

    const multi = Accordion({ items: [{ label: "A", content: "AA" }], multiple: true });
    expect(multi.html).toContain('x-data="{ open: {} }"');
    expect(multi.html).toContain('x-on:click="open[0] = !open[0]"');
  });
});

describe("<Popover>", () => {
  it("opens on click, closes on outside-click + escape, exposes data-open", () => {
    const n = Popover({ label: "Solutions", children: "Menu content" });
    expect(n.html).toContain('x-data="{ open: false }"');
    expect(n.html).toContain('x-on:click="open = !open"');
    expect(n.html).toContain('x-on:click.outside="open = false"');
    expect(n.html).toContain('x-on:keydown.escape.window="open = false"');
    expect(n.html).toContain(":data-open=\"open ? '' : null\"");
    expect(n.html).toContain("Menu content");
  });
});

describe("<Checkbox>", () => {
  it("binds + toggles via $set, checkbox role", async () => {
    class P {
      @expose agree = false;
      render() {
        return Checkbox({ bind: this.agree });
      }
    }
    const p = new P();
    const html = await _renderFlowPage(p as any, () => Promise.resolve(p.render()));
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("x-on:click=\"$flow.$set('agree', !$flow.agree)\"");
  });
});

describe("<Select>", () => {
  it("native select bound via flow:model; marks the selected option", async () => {
    class P {
      @expose country = "ca";
      render() {
        return Select({
          bind: this.country,
          placeholder: "Pick…",
          options: [
            { label: "Canada", value: "ca" },
            { label: "Brazil", value: "br" },
          ],
        });
      }
    }
    const p = new P();
    const html = await _renderFlowPage(p as any, () => Promise.resolve(p.render()));
    expect(html).toContain("<select");
    expect(html).toContain('flow:model="country"');
    expect(html).toContain('<option value="ca" selected>Canada</option>');
    expect(html).toContain("Pick…");
  });
});

describe("raw <select value={this.x}> binding", () => {
  // Regression: a bound <select> must (a) carry flow:model on the SELECT, and (b) render the
  // matching <option selected>. Previously the option children consumed the value-capture, so the
  // <select> rendered unbound and with no selected option — it always showed/submitted the first
  // option. (Manifested in akiba as every budget envelope saving the first category.)
  it("marks the matching <option selected> and binds the select (not an option)", async () => {
    class P {
      @expose country = "br";
      render() {
        // Equivalent to: <select value={this.country}>{opts.map(o => <option .../>)}</select>
        return jsx("select", {
          value: this.country,
          children: [
            jsx("option", { value: "ca", children: "Canada" }),
            jsx("option", { value: "br", children: "Brazil" }),
          ],
        });
      }
    }
    const p = new P();
    const html = await _renderFlowPage(p as any, () => Promise.resolve(p.render()));
    expect(html).toContain('flow:model="country"');
    expect(html).toContain('<option value="br" selected>Brazil</option>');
    // The non-selected option is left untouched; flow:model is never mis-attached to an <option>.
    expect(html).toContain('<option value="ca">Canada</option>');
    expect(html).not.toContain('<option value="ca" flow:model');
  });

  // The akiba pattern: <SelectInput value={this.x} options={...}/> spreads value onto a raw
  // <select> and maps option children inside the wrapper component.
  it("binds through a wrapper component that maps option children", async () => {
    function Picker(props: { value: string; options: { value: string; label: string }[] }) {
      const { options, ...rest } = props;
      return jsx("select", {
        ...rest,
        children: options.map((o) => jsx("option", { value: o.value, children: o.label })),
      });
    }
    class P {
      @expose plan = "pro";
      render() {
        return Picker({
          value: this.plan,
          options: [
            { value: "free", label: "Free" },
            { value: "pro", label: "Pro" },
          ],
        });
      }
    }
    const p = new P();
    const html = await _renderFlowPage(p as any, () => Promise.resolve(p.render()));
    expect(html).toContain('flow:model="plan"');
    expect(html).toContain('<option value="pro" selected>Pro</option>');
  });
});

describe("<RadioGroup>", () => {
  it("radiogroup + reactive aria-checked + arrow-key runtime", async () => {
    class P {
      @expose plan = "pro";
      render() {
        return RadioGroup({
          bind: this.plan,
          options: [
            { label: "Free", value: "free" },
            { label: "Pro", value: "pro" },
          ],
        });
      }
    }
    const p = new P();
    const html = await _renderFlowPage(p as any, () => Promise.resolve(p.render()));
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("flowRadioGroup({ name: 'plan' })");
    expect(html).toContain('x-on:keydown="onKey($event)"');
    expect(html).toContain('x-on:click="select(&quot;free&quot;)"');
    expect(html).toContain(':aria-checked="$flow.plan === &quot;pro&quot;"');
  });
});

describe("<Listbox>", () => {
  it("listbox button + options bound to the flowListbox runtime", async () => {
    class P {
      @expose assignee: number | null = 2;
      render() {
        return Listbox({
          bind: this.assignee,
          options: [
            { label: "Jo", value: 1 },
            { label: "Sam", value: 2 },
          ],
        });
      }
    }
    const p = new P();
    const html = await _renderFlowPage(p as any, () => Promise.resolve(p.render()));
    expect(html).toContain("flowListbox({ name: 'assignee', multiple: false })");
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('data-value="2"');
    expect(html).toContain('x-on:click="select(2)"');
    expect(html).toContain('id="assignee-opt-1"');
    expect(html).toContain("Sam");
  });
});

describe("<Combobox>", () => {
  it("client mode: filters options locally via x-show, no query binding", async () => {
    class P {
      @expose pick: number | null = null;
      render() {
        return Combobox({
          bind: this.pick,
          options: [
            { label: "Jocelyn", value: 1 },
            { label: "Josh", value: 2 },
          ],
        });
      }
    }
    const p = new P();
    const html = await _renderFlowPage(p as any, () => Promise.resolve(p.render()));
    expect(html).toContain("flowCombobox({ name: 'pick', queryName: null");
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('x-on:click="selectEl($event.currentTarget)"');
    expect(html).toContain(".includes(query.toLowerCase())");
    expect(html).not.toContain("flow:model.live");
  });

  it("server mode: query binds flow:model.live, options not locally filtered", async () => {
    class P {
      @expose cityId: number | null = null;
      @expose search = "";
      render() {
        return Combobox({
          bind: this.cityId,
          query: this.search,
          options: [{ label: "Oslo", value: 10 }],
        });
      }
    }
    const p = new P();
    const html = await _renderFlowPage(p as any, () => Promise.resolve(p.render()));
    expect(html).toContain('flow:model.live="search"');
    expect(html).toContain("queryName: 'search'");
    expect(html).not.toContain(".includes(query.toLowerCase())");
  });
});

describe("<Field> / <Fieldset>", () => {
  it("Field wraps label + control + description + error with the flowField runtime", () => {
    const sentinel = { __isErrorField: true, __field: "email", __value: "Required" };
    const n = Field({
      label: "Email",
      description: "We never share it.",
      error: sentinel,
      children: { html: "<input>" },
    });
    expect(n.html).toContain('x-data="flowField()"');
    expect(n.html).toContain("<label");
    expect(n.html).toContain("Email");
    expect(n.html).toContain("data-flow-description");
    expect(n.html).toContain("We never share it.");
    expect(n.html).toContain('flow:error="email"'); // error span wired for aria
  });

  it("Fieldset renders a native fieldset + legend and cascades disabled", () => {
    const n = Fieldset({ legend: "Shipping", disabled: true, children: { html: "<input>" } });
    expect(n.html).toContain("<fieldset");
    expect(n.html).toContain("<legend");
    expect(n.html).toContain("Shipping");
    expect(n.html).toContain("disabled");
  });

  it("Label / Description emit their tags", () => {
    expect(Label({ children: "Name" }).html).toContain("<label");
    expect(Description({ children: "hint" }).html).toContain("data-flow-description");
  });
});

describe("<Modal> a11y upgrade", () => {
  it("traps focus while open and labels the dialog by its title", async () => {
    class P {
      @expose open = true;
      render() {
        return Modal({ show: this.open, title: "Edit" });
      }
    }
    const p = new P();
    const html = await _renderFlowPage(p as any, () => Promise.resolve(p.render()));
    // `.noscroll` is the half that stops the page behind scrolling; a trap
    // without it holds focus while the background moves under a finger.
    expect(html).toContain('x-trap.noscroll="$flow.open"');
    expect(html).toContain('aria-labelledby="flow-modal-title-open"');
    expect(html).toContain('id="flow-modal-title-open"');
  });
});

describe("<Drawer>", () => {
  it("slides from a side, traps focus, reuses the Escape close + labels by title", async () => {
    class P {
      @expose cart = false;
      render() {
        return Drawer({ show: this.cart, title: "Cart", side: "right" });
      }
    }
    const p = new P();
    const html = await _renderFlowPage(p as any, () => Promise.resolve(p.render()));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('x-show="$flow.cart"'); // reactive visibility (Alpine)
    expect(html).toContain('x-transition:enter-start="translate-x-full"'); // slides from the right
    expect(html).toContain('data-flow-modal="cart"'); // Escape-to-close hook
    expect(html).toContain('x-trap.noscroll="$flow.cart"'); // focus trap + scroll lock
    expect(html).toContain('aria-labelledby="flow-drawer-title-cart"');
    expect(html).toContain('flow:click="$flow.cart = false"'); // backdrop/close → local set
  });

  it("left side slides from the left edge", async () => {
    class P {
      @expose open = false;
      render() {
        return Drawer({ show: this.open, side: "left" });
      }
    }
    const p = new P();
    const html = await _renderFlowPage(p as any, () => Promise.resolve(p.render()));
    expect(html).toContain('x-transition:enter-start="-translate-x-full"');
  });
});

describe("<FileUpload>", () => {
  it("binds a file input via flow:model and wires the flowFileUpload runtime", async () => {
    class P {
      @expose photo: unknown = null;
      render() {
        return FileUpload({ bind: this.photo, accept: "image/*" });
      }
    }
    const p = new P();
    const html = await _renderFlowPage(p as any, () => Promise.resolve(p.render()));
    // The prop name rides into the Alpine expression as a JSON literal (&quot; decodes
    // before Alpine parses it), so a crafted name cannot close the string and run.
    expect(html).toContain("flowFileUpload({ name: &quot;photo&quot; })");
    expect(html).toContain('type="file"');
    expect(html).toContain('flow:model="photo"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('x-show="uploading"');
  });
});
