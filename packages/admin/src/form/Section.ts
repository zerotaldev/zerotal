/**
 * Form layout — group fields into titled, multi-column sections, tabs, wizard
 * steps and splits. A resource's `form()` may return a flat list of fields *or*
 * a mix of fields and sections; loose fields are gathered into a default
 * section. Fields and sections compose into the same `FormComponent[]`.
 *
 *   static form() {
 *     return [
 *       formSection("Profile").description("Public details").columns(2).schema([
 *         textInput("name").required(),
 *         textInput("email").email().required(),
 *       ]),
 *       formSection("Security").schema([
 *         textInput("password").password().confirmed().visibleOn("create"),
 *       ]),
 *     ];
 *   }
 */
import { Field } from "./Field.ts";

export class FormSection {
  /** @internal */ _heading?: string | undefined;
  /** @internal */ _description?: string;
  /** @internal */ _icon?: string;
  /** @internal */ _columns = 2;
  /** @internal */ _collapsible = false;
  /** @internal Render as a bordered <fieldset> with a <legend>. */
  _fieldset = false;
  /** @internal */ _fields: Field[] = [];

  constructor(heading?: string) {
    this._heading = heading;
  }

  static make(heading?: string): FormSection {
    return new FormSection(heading);
  }

  heading(heading: string): this {
    this._heading = heading;
    return this;
  }

  description(description: string): this {
    this._description = description;
    return this;
  }

  icon(name: string): this {
    this._icon = name;
    return this;
  }

  /** Number of columns the fields flow into (1–4). */
  columns(n: number): this {
    this._columns = Math.min(4, Math.max(1, n));
    return this;
  }

  collapsible(value = true): this {
    this._collapsible = value;
    return this;
  }

  /** The fields contained in this section. */
  schema(fields: Field[]): this {
    this._fields = fields;
    return this;
  }

  getFields(): Field[] {
    return this._fields;
  }
}

// ── Tabs layout ─────────────────────────────────────────────────────────────────

export class FormTab {
  /** @internal */ _label: string;
  /** @internal */ _icon?: string;
  /** @internal */ _columns = 2;
  /** @internal */ _fields: Field[] = [];

  constructor(label: string) {
    this._label = label;
  }

  icon(name: string): this {
    this._icon = name;
    return this;
  }

  columns(n: number): this {
    this._columns = Math.min(4, Math.max(1, n));
    return this;
  }

  schema(fields: Field[]): this {
    this._fields = fields;
    return this;
  }

  getFields(): Field[] {
    return this._fields;
  }
}

/** A tabbed group of fields — switches client-side; all panels stay in the DOM. */
export class FormTabs {
  /** @internal */ _tabs: FormTab[];
  constructor(tabs: FormTab[]) {
    this._tabs = tabs;
  }
  getFields(): Field[] {
    return this._tabs.flatMap((t) => t.getFields());
  }
}

/** Factory for a single tab. */
export function formTab(label: string): FormTab {
  return new FormTab(label);
}

/** Factory for a tabbed layout. */
export function formTabs(tabs: FormTab[]): FormTabs {
  return new FormTabs(tabs);
}

// ── Wizard layout ───────────────────────────────────────────────────────────────

export class WizardStep {
  /** @internal */ _label: string;
  /** @internal */ _description?: string;
  /** @internal */ _icon?: string;
  /** @internal */ _columns = 1;
  /** @internal */ _fields: Field[] = [];

  constructor(label: string) {
    this._label = label;
  }

  description(text: string): this {
    this._description = text;
    return this;
  }

  icon(name: string): this {
    this._icon = name;
    return this;
  }

  columns(n: number): this {
    this._columns = Math.min(4, Math.max(1, n));
    return this;
  }

  schema(fields: Field[]): this {
    this._fields = fields;
    return this;
  }

  getFields(): Field[] {
    return this._fields;
  }
}

/** A multi-step wizard — validates each step before advancing; submits on the last. */
export class Wizard {
  /** @internal */ _steps: WizardStep[];
  constructor(steps: WizardStep[]) {
    this._steps = steps;
  }
  getFields(): Field[] {
    return this._steps.flatMap((s) => s.getFields());
  }
}

/** Factory for a single wizard step. */
export function wizardStep(label: string): WizardStep {
  return new WizardStep(label);
}

/** Factory for a wizard layout. */
export function wizard(steps: WizardStep[]): Wizard {
  return new Wizard(steps);
}

// ── Fieldset / Split / Callout / Prime (minor layout primitives) ─────────────────

/** A section rendered as a bordered `<fieldset>` with a `<legend>`. */
export function fieldset(legend?: string): FormSection {
  const s = new FormSection(legend);
  s._fieldset = true;
  s._columns = 1;
  return s;
}

export type CalloutTone = "default" | "primary" | "success" | "warning" | "destructive";

/** A non-field callout/notice block in a form schema. */
export class Callout {
  /** @internal */ _content: string;
  /** @internal */ _tone: CalloutTone = "default";
  /** @internal */ _icon?: string;
  /** @internal */ _heading?: string | undefined;
  constructor(content: string) {
    this._content = content;
  }
  tone(tone: CalloutTone): this {
    this._tone = tone;
    return this;
  }
  icon(name: string): this {
    this._icon = name;
    return this;
  }
  heading(heading: string): this {
    this._heading = heading;
    return this;
  }
}
export function callout(content: string): Callout {
  return new Callout(content);
}

export type PrimeKind = "text" | "html" | "image";

/** A static "prime" display component in a schema — text, raw HTML, or an image. */
export class Prime {
  /** @internal */ _kind: PrimeKind;
  /** @internal */ _content: string;
  /** @internal */ _alt?: string;
  constructor(kind: PrimeKind, content: string) {
    this._kind = kind;
    this._content = content;
  }
  alt(alt: string): this {
    this._alt = alt;
    return this;
  }
}
export function prime(text: string): Prime {
  return new Prime("text", text);
}
export function primeHtml(html: string): Prime {
  return new Prime("html", html);
}
export function primeImage(src: string): Prime {
  return new Prime("image", src);
}

/** Side-by-side sections. */
export class FormSplit {
  /** @internal */ _sections: FormSection[];
  constructor(sections: FormSection[]) {
    this._sections = sections;
  }
  getFields(): Field[] {
    return this._sections.flatMap((s) => s.getFields());
  }
}
export function split(sections: FormSection[]): FormSplit {
  return new FormSplit(sections);
}

/** A form is an ordered list of layout components and/or loose fields. */
export type FormComponent = FormSection | FormTabs | Wizard | FormSplit | Callout | Prime | Field;

/** A titled, multi-column block of form fields. */
export function formSection(heading?: string): FormSection {
  return new FormSection(heading);
}

export function isFormSection(c: FormComponent): c is FormSection {
  return c instanceof FormSection;
}

/** Collect every field across sections, tab groups, + loose fields, in order. */
export function flattenFields(components: FormComponent[]): Field[] {
  const out: Field[] = [];
  for (const c of components) {
    if (
      c instanceof FormSection ||
      c instanceof FormTabs ||
      c instanceof Wizard ||
      c instanceof FormSplit
    ) {
      out.push(...c.getFields());
    } else if (c instanceof Callout || c instanceof Prime) {
      // Display-only — no fields.
    } else {
      out.push(c);
    }
  }
  return out;
}

/** Normalize components into sections, wrapping loose fields in a default section. */
export function toFormSections(components: FormComponent[]): FormSection[] {
  const sections: FormSection[] = [];
  let loose: Field[] = [];
  const flush = (): void => {
    if (loose.length) {
      sections.push(new FormSection().columns(2).schema(loose));
      loose = [];
    }
  };
  for (const c of components) {
    if (c instanceof FormSection) {
      flush();
      sections.push(c);
    } else if (c instanceof Field) {
      loose.push(c);
    }
  }
  flush();
  return sections;
}

/** A renderable layout block. */
export type FormBlock =
  | { kind: "section"; section: FormSection }
  | { kind: "tabs"; tabs: FormTabs }
  | { kind: "wizard"; wizard: Wizard }
  | { kind: "split"; split: FormSplit }
  | { kind: "callout"; callout: Callout }
  | { kind: "prime"; prime: Prime };

/** Normalize the schema into ordered layout blocks (loose fields → a section). */
export function toFormLayout(components: FormComponent[]): FormBlock[] {
  const blocks: FormBlock[] = [];
  let loose: Field[] = [];
  const flush = (): void => {
    if (loose.length) {
      blocks.push({ kind: "section", section: new FormSection().columns(2).schema(loose) });
      loose = [];
    }
  };
  for (const c of components) {
    if (c instanceof FormTabs) {
      flush();
      blocks.push({ kind: "tabs", tabs: c });
    } else if (c instanceof Wizard) {
      flush();
      blocks.push({ kind: "wizard", wizard: c });
    } else if (c instanceof FormSplit) {
      flush();
      blocks.push({ kind: "split", split: c });
    } else if (c instanceof Callout) {
      flush();
      blocks.push({ kind: "callout", callout: c });
    } else if (c instanceof Prime) {
      flush();
      blocks.push({ kind: "prime", prime: c });
    } else if (c instanceof FormSection) {
      flush();
      blocks.push({ kind: "section", section: c });
    } else {
      loose.push(c);
    }
  }
  flush();
  return blocks;
}
