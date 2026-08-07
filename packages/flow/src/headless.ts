// ── Headless components (@zerotal/flow) ──────────────────────────────────
//
// Unstyled, fully-accessible interactive primitives — the Headless UI philosophy
// adapted to Flow. They ship NO visual classes: state is exposed via `data-*`
// attributes (`data-open`, `data-checked`, `data-active`) so you Tailwind-style
// them yourself, e.g. `class="data-[open]:rotate-180"`.
//
// Behaviour is driven by Alpine (open/close, keyboard, focus) and ARIA roles are
// wired in. Components that hold a value (Switch) bind to an @expose prop and sync
// to the server via $flow.$set — so the value persists and submits like any field.
//
//   <Switch bind={this.enabled} />
//   <Disclosure label="Details">…</Disclosure>
//   <Accordion items={[{ label, content }]} />
//   <Popover trigger={<button>Menu</button>}>…</Popover>

import { jsx, _resolveReactiveName, _injectedBindKey } from "./jsx-runtime.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

// Append extra classes without clobbering a structural base.
function cx(base: string, extra?: string): string {
  return extra ? `${base} ${extra}`.trim() : base;
}

// ── <Switch> ──────────────────────────────────────────────────────────────────
// An accessible on/off toggle (role="switch"). Bind it to an @expose boolean:
// clicking (or Space/Enter — native on a <button>) flips it and syncs to the
// server. Style the on-state with `data-[checked]:…`.
//
//   <Switch bind={this.notify} class="… data-[checked]:bg-indigo-600" />

export interface SwitchProps {
  /** Bound @expose boolean — `this.enabled`. */
  bind: unknown;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * An accessible on/off toggle (`role="switch"`) bound to an `@expose` boolean: clicking
 * (or Space/Enter) flips it and syncs to the server via `$flow.$set`. Unstyled — target the
 * on-state with `data-[checked]:…`.
 * @category Headless components
 *
 * @example
 * ```tsx
 * <Switch bind={this.notify} class="… data-[checked]:bg-indigo-600" />
 * ```
 */
export function Switch(props: SwitchProps): HtmlNode {
  const { bind, class: cls, children, ...rest } = props;
  const name = _injectedBindKey(props, "bind") ?? _resolveReactiveName(bind);
  const on = Boolean(bind);

  const out: Record<string, unknown> = {
    ...rest,
    type: "button",
    role: "switch",
    tabindex: 0,
    "aria-checked": on ? "true" : "false", // ARIA wants the string, not a bare attr
    // `group` so a child knob can react to the on-state with `group-data-[checked]:…`
    // (the data-checked attribute lives on this button, not on the child).
    class: cx("flow-switch group", cls),
    children,
  };
  if (on) out["data-checked"] = "";

  if (name) {
    // flow:bind:attr is imperatively synced by the bridge on every state change,
    // avoiding the Firefox SpiderMonkey issue where reading $flow through a nested
    // Proxy doesn't establish Alpine reactive subscriptions for :attr bindings.
    out["flow:bind:attr"] = JSON.stringify({ "aria-checked": name, "data-checked": name });
    out["x-on:click"] = `$flow.$set('${name}', !$flow.${name})`;
  }
  return jsx("button", out);
}

// ── <Disclosure> ────────────────────────────────────────────────────────────────
// A single collapsible section (button + panel) with correct aria-expanded /
// aria-controls wiring. Client-side only. `data-open` is exposed on both the
// trigger and the panel for styling.
//
//   <Disclosure label="What is your refund policy?">Full refund within 30 days.</Disclosure>

export interface DisclosureProps {
  label?: unknown;
  /** Custom trigger (overrides `label`). */
  trigger?: unknown;
  defaultOpen?: boolean;
  class?: string;
  /** Classes for the trigger button. */
  buttonClass?: string;
  /** Classes for the panel. */
  panelClass?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * A single collapsible section (trigger button + panel) with correct `aria-expanded` /
 * `aria-controls` wiring. Client-side only; `data-open` is exposed on both parts for styling.
 * @category Headless components
 */
export function Disclosure(props: DisclosureProps): HtmlNode {
  const {
    label,
    trigger,
    defaultOpen,
    class: cls,
    buttonClass,
    panelClass,
    children,
    ...rest
  } = props;

  const button = trigger
    ? jsx("span", {
        "x-on:click": "open = !open",
        ":aria-expanded": "open",
        ":data-open": "open ? '' : null",
        "aria-controls": "",
        ":aria-controls": "$id('flow-disclosure')",
        role: "button",
        tabindex: 0,
        class: cx("flow-disclosure-button", buttonClass),
        children: trigger,
      })
    : jsx("button", {
        type: "button",
        "x-on:click": "open = !open",
        ":aria-expanded": "open",
        ":data-open": "open ? '' : null",
        ":aria-controls": "$id('flow-disclosure')",
        class: cx("flow-disclosure-button", buttonClass),
        children: label ?? "Details",
      });

  const panel = jsx("div", {
    ":id": "$id('flow-disclosure')",
    "x-show": "open",
    "x-cloak": true,
    ":data-open": "open ? '' : null",
    class: cx("flow-disclosure-panel", panelClass),
    children,
  });

  return jsx("div", {
    ...rest,
    "x-data": `{ open: ${defaultOpen ? "true" : "false"} }`,
    "x-id": "['flow-disclosure']",
    class: cx("flow-disclosure", cls),
    children: [button, panel],
  });
}

// ── <Accordion> ───────────────────────────────────────────────────────────────
// A group of disclosures. Single-open by default (an "exclusive" accordion); pass
// `multiple` to allow several open at once. Each item gets aria-expanded/controls.
//
//   <Accordion items={[{ label: 'A', content: <p/> }, …]} />

export interface AccordionItem {
  label: unknown;
  content: unknown;
}

export interface AccordionProps {
  items: AccordionItem[];
  /** Allow multiple panels open simultaneously (default false → exclusive). */
  multiple?: boolean;
  /** Index open initially (single mode), or -1 for none. */
  defaultIndex?: number;
  class?: string;
  itemClass?: string;
  buttonClass?: string;
  panelClass?: string;
  [key: string]: unknown;
}

/**
 * A group of disclosures. Single-open (exclusive) by default; pass `multiple` to allow
 * several open at once. Each item gets `aria-expanded`/`aria-controls` wiring.
 * @category Headless components
 */
export function Accordion(props: AccordionProps): HtmlNode {
  const {
    items,
    multiple,
    defaultIndex = -1,
    class: cls,
    itemClass,
    buttonClass,
    panelClass,
    ...rest
  } = props;

  // Single mode tracks one active index; multiple mode tracks an open-map.
  const data = multiple ? `{ open: {} }` : `{ active: ${defaultIndex} }`;
  const isOpen = (i: number) => (multiple ? `open[${i}]` : `active === ${i}`);
  const toggle = (i: number) =>
    multiple ? `open[${i}] = !open[${i}]` : `active = active === ${i} ? -1 : ${i}`;

  const rows = items.map((it, i) =>
    jsx("div", {
      class: cx("flow-accordion-item", itemClass),
      "x-id": "['flow-accordion']",
      children: [
        jsx("button", {
          type: "button",
          "x-on:click": toggle(i),
          ":aria-expanded": isOpen(i),
          ":data-open": `${isOpen(i)} ? '' : null`,
          ":aria-controls": "$id('flow-accordion')",
          class: cx("flow-accordion-button", buttonClass),
          children: it.label,
        }),
        jsx("div", {
          ":id": "$id('flow-accordion')",
          "x-show": isOpen(i),
          "x-cloak": true,
          ":data-open": `${isOpen(i)} ? '' : null`,
          class: cx("flow-accordion-panel", panelClass),
          children: it.content,
        }),
      ],
    }),
  );

  return jsx("div", {
    ...rest,
    "x-data": data,
    class: cx("flow-accordion", cls),
    children: rows,
  });
}

// ── <Popover> ─────────────────────────────────────────────────────────────────
// A generic anchored panel: click to open, click-outside or Escape to close. The
// rigorous, unstyled cousin of <Dropdown>. `data-open` is exposed for styling.
//
//   <Popover trigger={<button>Solutions ▾</button>}>… arbitrary content …</Popover>

export interface PopoverProps {
  label?: unknown;
  trigger?: unknown;
  class?: string;
  buttonClass?: string;
  panelClass?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * A generic anchored panel: click to open, click-outside or Escape to close — the rigorous,
 * unstyled cousin of `<Dropdown>`. `data-open` is exposed for styling.
 * @category Headless components
 */
export function Popover(props: PopoverProps): HtmlNode {
  const { label, trigger, class: cls, buttonClass, panelClass, children, ...rest } = props;

  const button = trigger
    ? jsx("span", {
        "x-on:click": "open = !open",
        ":aria-expanded": "open",
        ":data-open": "open ? '' : null",
        role: "button",
        tabindex: 0,
        class: cx("flow-popover-button", buttonClass),
        children: trigger,
      })
    : jsx("button", {
        type: "button",
        "x-on:click": "open = !open",
        ":aria-expanded": "open",
        ":data-open": "open ? '' : null",
        class: cx("flow-popover-button", buttonClass),
        children: label ?? "Open",
      });

  const panel = jsx("div", {
    "x-show": "open",
    "x-cloak": true,
    "x-transition": true,
    "x-on:click.outside": "open = false",
    "x-on:keydown.escape.window": "open = false",
    ":data-open": "open ? '' : null",
    class: cx("flow-popover-panel", panelClass),
    children,
  });

  return jsx("div", {
    ...rest,
    "x-data": "{ open: false }",
    class: cx("flow-popover", cls),
    children: [button, panel],
  });
}

// ── <Checkbox> ──────────────────────────────────────────────────────────────
// An accessible checkbox (role="checkbox") bound to an @expose boolean. Like
// <Switch> but checkbox-semantic. Style the checked state with `data-[checked]:…`.
//
//   <Checkbox bind={this.agree} class="… data-[checked]:bg-indigo-600" />

export interface CheckboxProps {
  bind: unknown;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * An accessible checkbox (`role="checkbox"`) bound to an `@expose` boolean — like
 * {@link Switch} but checkbox-semantic. Style the checked state with `data-[checked]:…`.
 * @category Headless components
 */
export function Checkbox(props: CheckboxProps): HtmlNode {
  const { bind, class: cls, children, ...rest } = props;
  const name = _injectedBindKey(props, "bind") ?? _resolveReactiveName(bind);
  const on = Boolean(bind);

  const out: Record<string, unknown> = {
    ...rest,
    type: "button",
    role: "checkbox",
    tabindex: 0,
    "aria-checked": on ? "true" : "false",
    class: cx("flow-checkbox", cls),
    children,
  };
  if (on) out["data-checked"] = "";
  if (name) {
    out["flow:bind:attr"] = JSON.stringify({ "aria-checked": name, "data-checked": name });
    out["x-on:click"] = `$flow.$set('${name}', !$flow.${name})`;
  }
  return jsx("button", out);
}

// ── <Select> ──────────────────────────────────────────────────────────────────
// A styled native <select> bound to an @expose value (via flow:model). Reliable
// and fully accessible for free — reach for <Listbox> only when you need custom
// option markup.
//
//   <Select bind={this.country} options={[{ label: 'Canada', value: 'ca' }]} />

export interface SelectOption {
  label: unknown;
  value: string | number;
}
export interface SelectProps {
  bind: unknown;
  options: SelectOption[];
  /** Optional empty/placeholder first option. */
  placeholder?: string;
  class?: string;
  [key: string]: unknown;
}

/**
 * A styled native `<select>` bound to an `@expose` value via `flow:model` — reliable and
 * fully accessible for free. Reach for {@link Listbox} only when you need custom option markup.
 * @category Headless components
 *
 * @example
 * ```tsx
 * <Select bind={this.country} options={[{ label: 'Canada', value: 'ca' }]} />
 * ```
 */
export function Select(props: SelectProps): HtmlNode {
  const {
    bind,
    options,
    placeholder,
    class: cls,
    children: _ignore,
    ...rest
  } = props as SelectProps & { children?: unknown };
  const name = _injectedBindKey(props, "bind") ?? _resolveReactiveName(bind);
  const current = bind as string | number | undefined;

  const opts = options.map((o) =>
    jsx("option", {
      value: o.value,
      ...(o.value === current ? { selected: true } : {}),
      children: o.label,
    }),
  );
  const all = placeholder
    ? [
        jsx("option", {
          value: "",
          disabled: true,
          ...(current == null || current === "" ? { selected: true } : {}),
          children: placeholder,
        }),
        ...opts,
      ]
    : opts;

  const out: Record<string, unknown> = { ...rest, class: cx("flow-select", cls), children: all };
  if (name) out["flow:model"] = name;
  return jsx("select", out);
}

// ── <RadioGroup> ──────────────────────────────────────────────────────────────
// An accessible set of radios (role="radiogroup"/"radio") bound to an @expose
// value, with arrow-key roving (flowRadioGroup runtime). Style the selected option
// with `data-[checked]:…`.
//
//   <RadioGroup bind={this.plan} options={[{ label: 'Pro', value: 'pro' }]} />

export interface RadioOption {
  label: unknown;
  value: string | number;
}
export interface RadioGroupProps {
  bind: unknown;
  options: RadioOption[];
  class?: string;
  optionClass?: string;
  [key: string]: unknown;
}

/**
 * An accessible set of radios (`role="radiogroup"`/`"radio"`) bound to an `@expose` value,
 * with arrow-key roving. Style the selected option with `data-[checked]:…`.
 * @category Headless components
 */
export function RadioGroup(props: RadioGroupProps): HtmlNode {
  const {
    bind,
    options,
    class: cls,
    optionClass,
    children: _ignore,
    ...rest
  } = props as RadioGroupProps & { children?: unknown };
  const name = _injectedBindKey(props, "bind") ?? _resolveReactiveName(bind);
  const current = bind;

  const radios = options.map((o, i) => {
    const v = JSON.stringify(o.value);
    const selected = o.value === current;
    const out: Record<string, unknown> = {
      role: "radio",
      "aria-checked": selected ? "true" : "false",
      class: cx("flow-radio", optionClass),
      children: o.label,
    };
    if (selected) out["data-checked"] = "";
    // first option is tab-reachable when nothing is selected (roving tabindex)
    out["tabindex"] = selected || (current == null && i === 0) ? 0 : -1;
    if (name) {
      out[":aria-checked"] = `$flow.${name} === ${v}`;
      out[":data-checked"] = `$flow.${name} === ${v} ? '' : null`;
      out[":tabindex"] = `$flow.${name} === ${v} || ($flow.${name} == null && ${i === 0}) ? 0 : -1`;
      out["x-on:click"] = `select(${v})`;
      out["x-on:keydown"] = "onKey($event)";
    }
    return jsx("div", out);
  });

  return jsx("div", {
    ...rest,
    role: "radiogroup",
    "x-data": name ? `flowRadioGroup({ name: '${name}' })` : "{}",
    class: cx("flow-radiogroup", cls),
    children: radios,
  });
}

// ── <Listbox> ─────────────────────────────────────────────────────────────────
// A custom, fully-keyboard-navigable select (role="listbox") bound to an @expose
// value — arrow keys, Home/End, Enter/Escape, aria-activedescendant. Use custom
// option markup; the committed value round-trips through the server. Pass
// `multiple` for multi-select (value is an array). States: data-[selected],
// data-[active], data-[open].
//
//   <Listbox bind={this.assignee} options={[{ label: 'Jo', value: 1 }]} />

export interface ListboxOption {
  label: unknown;
  value: string | number;
}
export interface ListboxProps {
  bind: unknown;
  options: ListboxOption[];
  multiple?: boolean;
  placeholder?: string;
  class?: string;
  buttonClass?: string;
  optionsClass?: string;
  optionClass?: string;
  [key: string]: unknown;
}

/**
 * A custom, fully keyboard-navigable select (`role="listbox"`) bound to an `@expose` value —
 * arrow keys, Home/End, Enter/Escape, `aria-activedescendant`. Pass `multiple` for
 * multi-select (value is an array). States: `data-[selected]`, `data-[active]`, `data-[open]`.
 * @category Headless components
 */
export function Listbox(props: ListboxProps): HtmlNode {
  const {
    bind,
    options,
    multiple,
    placeholder,
    class: cls,
    buttonClass,
    optionsClass,
    optionClass,
    children: _ignore,
    ...rest
  } = props as ListboxProps & { children?: unknown };
  const name = _injectedBindKey(props, "bind") ?? _resolveReactiveName(bind);
  const current = bind;

  // Server-rendered button label (updates on the round-trip after select).
  const selectedLabel = (() => {
    if (multiple) {
      const arr = Array.isArray(current) ? current : [];
      const labels = options.filter((o) => arr.includes(o.value)).map((o) => o.label);
      return labels.length ? labels.join(", ") : (placeholder ?? "Select…");
    }
    const hit = options.find((o) => o.value === current);
    return hit ? hit.label : (placeholder ?? "Select…");
  })();

  const button = jsx("button", {
    type: "button",
    "x-on:click": "toggle()",
    "x-on:keydown": "onButtonKey($event)",
    ":aria-expanded": "open",
    "aria-haspopup": "listbox",
    ":data-open": "open ? '' : null",
    class: cx("flow-listbox-button", buttonClass),
    children: selectedLabel,
  });

  const optionEls = options.map((o, i) => {
    const v = JSON.stringify(o.value);
    const selected = multiple
      ? Array.isArray(current) && current.includes(o.value)
      : o.value === current;
    const out: Record<string, unknown> = {
      id: name ? `${name}-opt-${i}` : undefined,
      role: "option",
      "data-value": v,
      "aria-selected": selected ? "true" : "false",
      ":aria-selected": `isSelected(${v})`,
      ":data-selected": `isSelected(${v}) ? '' : null`,
      ":data-active": `active === ${i} ? '' : null`,
      "x-on:click": `select(${v})`,
      "x-on:mousemove": `active = ${i}`,
      class: cx("flow-listbox-option", optionClass),
      children: o.label,
    };
    if (selected) out["data-selected"] = "";
    return jsx("li", out);
  });

  const list = jsx("ul", {
    role: "listbox",
    tabindex: -1,
    "x-show": "open",
    "x-cloak": true,
    "x-on:keydown": "onKey($event)",
    "x-on:click.outside": "close()",
    ":aria-activedescendant": name ? `active >= 0 ? '${name}-opt-' + active : null` : "null",
    ...(multiple ? { "aria-multiselectable": "true" } : {}),
    class: cx("flow-listbox-options", optionsClass),
    children: optionEls,
  });

  return jsx("div", {
    ...rest,
    "x-data": name
      ? `flowListbox({ name: '${name}', multiple: ${!!multiple} })`
      : "{ open: false, active: -1 }",
    class: cx("flow-listbox", cls),
    children: [button, list],
  });
}

// ── <Combobox> ────────────────────────────────────────────────────────────────
// An autocomplete: a text input + a filtered option list, bound to an @expose
// value. Two modes:
//   • client (default) — options are rendered once and filtered locally as you type.
//   • server — pass `query={this.search}`: the input uses flow:model.live, so the
//     SERVER re-renders the (already-filtered) options every keystroke. Render
//     `options` from your filtered server list. This is server-side autocomplete
//     with full headless UX.
//
//   <Combobox bind={this.assignee} options={people} />                 // client filter
//   <Combobox bind={this.cityId} query={this.search} options={hits} /> // server filter
//
// For an unambiguous binding you can pass explicit prop names (`name` / `queryName`
// strings) instead of `bind` / `query`. States: data-[active], data-[selected].
// ARIA: role=combobox/listbox/option.

export interface ComboboxOption {
  label: string;
  value: string | number;
}
export interface ComboboxProps {
  bind?: unknown;
  /** Present → server-filter mode: the bound query @expose prop. */
  query?: unknown;
  /** Explicit value prop-name (escape hatch instead of `bind`). */
  name?: string;
  /** Explicit query prop-name (escape hatch instead of `query`). */
  queryName?: string;
  options: ComboboxOption[];
  placeholder?: string;
  class?: string;
  inputClass?: string;
  optionsClass?: string;
  optionClass?: string;
  [key: string]: unknown;
}

/**
 * An autocomplete: a text input plus a filtered option list bound to an `@expose` value.
 * Client mode (default) filters locally; passing `query={this.search}` switches to server-side
 * filtering, where the input uses `flow:model.live` and the server re-renders matches per
 * keystroke. States: `data-[active]`, `data-[selected]`.
 * @category Headless components
 *
 * @example
 * ```tsx
 * <Combobox bind={this.assignee} options={people} />                 // client filter
 * <Combobox bind={this.cityId} query={this.search} options={hits} /> // server filter
 * ```
 */
export function Combobox(props: ComboboxProps): HtmlNode {
  const {
    bind,
    query,
    name: nameProp,
    queryName: queryNameProp,
    options,
    placeholder,
    class: cls,
    inputClass,
    optionsClass,
    optionClass,
    children: _ignore,
    ...rest
  } = props as ComboboxProps & { children?: unknown };

  // Resolve the QUERY binding first (its capture is freshest — it's evaluated last
  // in the props), then the value binding (identity fallback). `name`/`queryName`
  // strings are explicit overrides — note `bind`/`query` are reactive *values*, so
  // we never treat a string value as a name.
  const queryName =
    queryNameProp ??
    _injectedBindKey(props, "query") ??
    (query === undefined ? null : _resolveReactiveName(query));
  const name = nameProp ?? _injectedBindKey(props, "bind") ?? _resolveReactiveName(bind);
  const server = queryName != null;
  const current = bind;

  const selectedLabel = (() => {
    const hit = options.find((o) => o.value === current);
    return hit ? hit.label : "";
  })();

  const listId = name ? `${name}-list` : "flow-combobox-list";

  const input = jsx("input", {
    type: "text",
    role: "combobox",
    autocomplete: "off",
    "aria-autocomplete": "list",
    "aria-controls": listId,
    ":aria-expanded": "open",
    ...(placeholder ? { placeholder } : {}),
    ...(server ? (queryName ? { "flow:model.live": queryName } : {}) : { ":value": "query" }),
    "x-on:input": "onInput($event)",
    "x-on:focus": "openList()",
    "x-on:click": "openList()",
    "x-on:keydown": "onKey($event)",
    class: cx("flow-combobox-input", inputClass),
  });

  const optionEls = options.map((o, i) => {
    const v = JSON.stringify(o.value);
    const labelLower = JSON.stringify(o.label.toLowerCase());
    const selected = o.value === current;
    const out: Record<string, unknown> = {
      id: name ? `${name}-opt-${i}` : undefined,
      role: "option",
      "data-value": v,
      "data-label": o.label,
      "aria-selected": selected ? "true" : "false",
      ":aria-selected": `isSelected(${v})`,
      ":data-selected": `isSelected(${v}) ? '' : null`,
      ":data-active": `active === ${i} ? '' : null`,
      "x-on:click": "selectEl($event.currentTarget)",
      "x-on:mousemove": `active = ${i}`,
      class: cx("flow-combobox-option", optionClass),
      children: o.label,
    };
    if (selected) out["data-selected"] = "";
    // Client mode filters locally; server mode renders only matches already.
    if (!server) out["x-show"] = `!query || ${labelLower}.includes(query.toLowerCase())`;
    return jsx("li", out);
  });

  const list = jsx("ul", {
    id: listId,
    role: "listbox",
    "x-show": "open",
    "x-cloak": true,
    "x-on:click.outside": "close()",
    ":aria-activedescendant": name ? `active >= 0 ? '${name}-opt-' + active : null` : "null",
    class: cx("flow-combobox-options", optionsClass),
    children: optionEls,
  });

  const config = name
    ? `flowCombobox({ name: '${name}', queryName: ${queryName ? `'${queryName}'` : "null"}, query: ${JSON.stringify(server ? "" : selectedLabel)} })`
    : "{ open: false, active: -1, query: '' }";

  return jsx("div", {
    ...rest,
    "x-data": config,
    class: cx("flow-combobox", cls),
    children: [input, list],
  });
}

// ── <Field> / <Label> / <Description> ─────────────────────────────────────────
// Accessibility glue around a single control. <Field> wraps a label, the control,
// an optional description, and an error, and (via the flowField runtime) wires
// `for`/`id`/`aria-describedby` and keeps `aria-invalid` in sync with the error.
//
//   <Field label="Email" description="We never share it." error={this.errors.email}>
//     <input value={this.form.email} />
//   </Field>
//
// You can also compose <Label>/<Description> manually inside <Field>.

export interface LabelProps {
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}
/**
 * A styled `<label>`. Compose inside {@link Field} (which wires `for`/`id`) or use standalone.
 * @category Headless components
 */
export function Label(props: LabelProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return jsx("label", { ...rest, class: cx("flow-label", cls), children });
}

export interface DescriptionProps {
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}
/**
 * Help/description text for a control; wired as `aria-describedby` when composed in {@link Field}.
 * @category Headless components
 */
export function Description(props: DescriptionProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return jsx("p", {
    ...rest,
    "data-flow-description": true,
    class: cx("flow-description", cls),
    children,
  });
}

export interface FieldProps {
  label?: unknown;
  description?: unknown;
  /** The field accessor — `this.errors.<field>`; renders a self-hiding message. */
  error?: unknown;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * Accessibility glue around a single control: wraps a label, the control, an optional
 * description, and an error, wiring `for`/`id`/`aria-describedby` and keeping `aria-invalid`
 * in sync with the error. Compose `<Label>`/`<Description>` manually or pass them as props.
 * @category Headless components
 *
 * @example
 * ```tsx
 * <Field label="Email" description="We never share it." error={this.errors.email}>
 *   <input value={this.form.email} />
 * </Field>
 * ```
 */
export function Field(props: FieldProps): HtmlNode {
  const { label, description, error, class: cls, children, ...rest } = props;
  const kids: unknown[] = [];
  if (label !== undefined && label !== null) kids.push(Label({ children: label }));
  kids.push(children);
  if (description !== undefined && description !== null)
    kids.push(Description({ children: description }));
  if (error !== undefined && error !== null) {
    // Same as <Error>: the `error` directive emits flow:error + flow:show + SSR text.
    kids.push(jsx("span", { error, class: "flow-field-error text-red-400 text-xs" }));
  }
  return jsx("div", {
    ...rest,
    "x-data": "flowField()",
    class: cx("flow-field", cls),
    children: kids,
  });
}

// ── <Fieldset> / <Legend> ───────────────────────────────────────────────────────
// Group related fields. A native <fieldset disabled> cascades the disabled state
// to every control inside it.
//
//   <Fieldset legend="Shipping" disabled={this.saving}>…</Fieldset>

export interface LegendProps {
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}
/**
 * A styled `<legend>` for a {@link Fieldset}.
 * @category Headless components
 */
export function Legend(props: LegendProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return jsx("legend", { ...rest, class: cx("flow-legend", cls), children });
}

export interface FieldsetProps {
  legend?: unknown;
  disabled?: boolean;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * Groups related fields under an optional legend. A native `<fieldset disabled>` cascades the
 * disabled state to every control inside it.
 * @category Headless components
 *
 * @example
 * ```tsx
 * <Fieldset legend="Shipping" disabled={this.saving}>…</Fieldset>
 * ```
 */
export function Fieldset(props: FieldsetProps): HtmlNode {
  const { legend, disabled, class: cls, children, ...rest } = props;
  const kids: unknown[] = [];
  if (legend !== undefined && legend !== null) kids.push(Legend({ children: legend }));
  kids.push(children);
  const out: Record<string, unknown> = { ...rest, class: cx("flow-fieldset", cls), children: kids };
  if (disabled) out["disabled"] = true;
  return jsx("fieldset", out);
}

// ── <Slider> ──────────────────────────────────────────────────────────────────
// A value chosen from a range, over a native `<input type="range">` so keyboard,
// touch and screen-reader support come from the platform rather than being
// rebuilt. Alpine owns the live value: the fill and any readout follow the thumb
// at frame rate, and the bound @expose prop is written once the drag settles.
//
// `data-dragging` is exposed while the pointer is down, so a readout can be
// shown only during the drag if you'd rather it not sit there permanently.
//
//   <Slider bind={this.volume} min={0} max={100} />

export interface SliderProps {
  /** Bound @expose number — `this.volume`. */
  bind?: unknown;
  name?: string;
  min?: number;
  max?: number;
  step?: number;
  class?: string;
  inputClass?: string;
  /**
   * Initial inline style for the input — a track gradient, typically.
   *
   * Server-rendered so the track is filled on first paint, then replaced by
   * {@link SliderProps.inputStyleExpression} once Alpine takes over.
   */
  inputStyle?: string;
  /**
   * Alpine expression producing the input's style while dragging. `value` and
   * `percent()` are in scope.
   */
  inputStyleExpression?: string;
  /** Rendered inside the wrapper, after the input — a readout, a tick strip. */
  children?: unknown;
  [key: string]: unknown;
}

export function Slider(props: SliderProps): HtmlNode {
  const {
    bind,
    name: nameProp,
    min = 0,
    max = 100,
    step = 1,
    class: cls,
    inputClass,
    inputStyle,
    inputStyleExpression,
    children,
    ...rest
  } = props;

  const name = nameProp ?? _injectedBindKey(props, "bind") ?? _resolveReactiveName(bind);
  const value = typeof bind === "number" ? bind : min;

  const config = JSON.stringify({ name, min, max, step });

  return jsx("div", {
    ...rest,
    "x-data": `flowSlider(${config})`,
    ":data-dragging": "dragging ? '' : null",
    class: cx("flow-slider", cls),
    children: [
      jsx("input", {
        type: "range",
        min,
        max,
        step,
        value,
        ...(inputStyle ? { style: inputStyle } : {}),
        ...(inputStyleExpression ? { ":style": inputStyleExpression } : {}),
        "x-model.number": "value",
        // Local while moving, synced on release: the two events are what keep a
        // drag smooth and the server eventually correct.
        "x-on:input": "onInput($event)",
        "x-on:change": "commit()",
        "x-on:keyup.debounce.200ms": "commit()",
        class: cx("flow-slider-input", inputClass),
      }),
      children,
    ],
  });
}

// ── <Toggle> / <ToggleGroup> ──────────────────────────────────────────────────
// A button that stays pressed, and a set of them. Distinct from Switch: a switch
// is a setting that applies immediately, a toggle is a mode you are in — which
// is why this reports `aria-pressed` rather than `role="switch"`.
//
// The pressed state flips locally the instant it is clicked and syncs to the
// bound prop after, so the button never waits on the network to look pressed.
//
//   <ToggleGroup bind={this.view} options={[{ value: "grid", label: "Grid" }]} />

export interface ToggleOption {
  value: string;
  label?: unknown;
  disabled?: boolean;
}

export interface ToggleGroupProps {
  /** Bound @expose value — a string, or an array when `multiple`. */
  bind?: unknown;
  name?: string;
  options: ToggleOption[];
  /** Allow several pressed at once; the bound value becomes an array. */
  multiple?: boolean;
  class?: string;
  optionClass?: string;
  [key: string]: unknown;
}

export function ToggleGroup(props: ToggleGroupProps): HtmlNode {
  const {
    bind,
    name: nameProp,
    options,
    multiple,
    class: cls,
    optionClass,
    children: _ignore,
    ...rest
  } = props as ToggleGroupProps & { children?: unknown };

  const name = nameProp ?? _injectedBindKey(props, "bind") ?? _resolveReactiveName(bind);
  const current = new Set(Array.isArray(bind) ? bind.map(String) : bind ? [String(bind)] : []);

  const buttons = options.map((option) => {
    const v = JSON.stringify(option.value);
    const on = current.has(option.value);
    const out: Record<string, unknown> = {
      type: "button",
      // Server-rendered pressed state, so the first paint is correct before
      // Alpine has initialised.
      "aria-pressed": on ? "true" : "false",
      ":aria-pressed": `isOn(${v})`,
      ":data-pressed": `isOn(${v}) ? '' : null`,
      "x-on:click": `toggle(${v})`,
      class: cx("flow-toggle", optionClass),
      children: option.label ?? option.value,
    };
    if (on) out["data-pressed"] = "";
    if (option.disabled) out["disabled"] = true;
    return jsx("button", out);
  });

  return jsx("div", {
    ...rest,
    // Single-choice reads as a radiogroup; multiple is a plain group of buttons.
    role: multiple ? "group" : "radiogroup",
    "x-data": `flowToggleGroup(${JSON.stringify({ name, multiple: Boolean(multiple) })})`,
    class: cx("flow-toggle-group", cls),
    children: buttons,
  });
}

// ── <Calendar> ────────────────────────────────────────────────────────────────
// A month grid for picking a date. Paging between months and selecting a day are
// entirely client-side — the grid is arithmetic, so a round-trip would be asking
// the server a question that needs no data. Only the chosen day is synced.
//
// Every cell is a real `<button>` inside a grid with `role="grid"`, so arrow-key
// and screen-reader behaviour come from the semantics rather than from script.
//
//   <Calendar bind={this.due} min={today} />

export interface CalendarProps {
  /** Bound @expose `YYYY-MM-DD` string. */
  bind?: unknown;
  name?: string;
  /** Month first shown, `YYYY-MM`. Defaults to the bound value's month, else now. */
  month?: string;
  /** Start weeks on Sunday instead of Monday. */
  sundayFirst?: boolean;
  min?: string;
  max?: string;
  class?: string;
  headerClass?: string;
  navClass?: string;
  weekdayClass?: string;
  gridClass?: string;
  dayClass?: string;
  [key: string]: unknown;
}

const FLOW_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function Calendar(props: CalendarProps): HtmlNode {
  const {
    bind,
    name: nameProp,
    month: monthProp,
    sundayFirst,
    min,
    max,
    class: cls,
    headerClass,
    navClass,
    weekdayClass,
    gridClass,
    dayClass,
    children: _ignore,
    ...rest
  } = props as CalendarProps & { children?: unknown };

  const name = nameProp ?? _injectedBindKey(props, "bind") ?? _resolveReactiveName(bind);
  const selected = typeof bind === "string" ? bind : "";
  const now = new Date();
  const month =
    monthProp ??
    (selected
      ? selected.slice(0, 7)
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);

  const weekdays = sundayFirst ? ["Sun", ...FLOW_WEEKDAYS.slice(0, 6)] : FLOW_WEEKDAYS;
  const config = JSON.stringify({ name, month, sundayFirst: Boolean(sundayFirst), min, max });

  return jsx("div", {
    ...rest,
    "x-data": `flowCalendar(${config})`,
    class: cx("flow-calendar", cls),
    children: [
      jsx("div", {
        class: cx("flow-calendar-header", headerClass),
        children: [
          jsx("button", {
            type: "button",
            "aria-label": "Previous month",
            "x-on:click": "shift(-1)",
            class: cx("flow-calendar-nav", navClass),
            children: "‹",
          }),
          jsx("span", { "x-text": "label()", class: "flow-calendar-label", children: "" }),
          jsx("button", {
            type: "button",
            "aria-label": "Next month",
            "x-on:click": "shift(1)",
            class: cx("flow-calendar-nav", navClass),
            children: "›",
          }),
        ],
      }),
      jsx("div", {
        role: "grid",
        class: cx("flow-calendar-grid", gridClass),
        children: [
          ...weekdays.map((d) =>
            jsx("span", {
              role: "columnheader",
              class: cx("flow-calendar-weekday", weekdayClass),
              children: d,
            }),
          ),
          // One template for all 42 cells: the markup ships once and Alpine
          // repeats it, rather than the server emitting six weeks of buttons
          // that are replaced the moment somebody pages the month.
          jsx("template", {
            "x-for": "cell in cells()",
            ":key": "cell.day",
            children: jsx("button", {
              type: "button",
              role: "gridcell",
              ":aria-label": "cell.day",
              ":aria-selected": "value === cell.day",
              ":data-selected": "value === cell.day ? '' : null",
              ":data-today": "today === cell.day ? '' : null",
              ":data-outside": "cell.inMonth ? null : ''",
              ":disabled": "isDisabled(cell.day)",
              "x-on:click": "select(cell.day)",
              "x-text": "dayNumber(cell.day)",
              class: cx("flow-calendar-day", dayClass),
              children: "",
            }),
          }),
        ],
      }),
    ],
  });
}
