/**
 * Form fields — the editable counterpart to {@link Entry} infolist entries,
 * declared once and rendered by the form page. A
 * field describes an input plus its validation; the Create/Edit page renders it
 * and a generated {@link Form} (see ./ResourceForm) backs the reactive binding.
 *
 *   textInput("name").required().maxLength(120)
 *   textInput("email").email().required().placeholder("you@example.com")
 *   textInput("password").password().required().minLength(8).visibleOn("create")
 *   textarea("bio").rows(4)
 *   select("role").options({ admin: "Admin", member: "Member" }).required()
 *   checkbox("is_active").label("Active").default(true)
 */
import type { HtmlNode } from "@zerotal/flow";
import type { RuleBuilder } from "@zerotal/validator";
import type { FieldRule } from "@zerotal/validator";

export type FieldType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "url"
  | "tel"
  | "textarea"
  | "select"
  | "checkbox"
  | "toggle"
  | "radio"
  | "checkboxList"
  | "date"
  | "datetime"
  | "time"
  | "color"
  | "hidden"
  | "tags"
  | "keyValue"
  | "file"
  | "media"
  | "slider"
  | "toggleButtons"
  | "code"
  | "markdown"
  | "richText"
  | "repeater"
  | "builder"
  | "custom";

export type FieldMode = "create" | "edit";

/** Predicate over the current form data — for reactive visibility / disabling. */
export type FieldPredicate = (data: Record<string, unknown>) => boolean;

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * A named block type for a {@link builder} field.
 * Each block has its own sub-schema; a builder row records which block it is.
 *
 *   builderBlock("heading").icon("type").schema([
 *     textInput("content").required(),
 *     select("level").options({ h2: "H2", h3: "H3" }),
 *   ])
 */
export class BuilderBlock {
  /** @internal */ name: string;
  /** @internal */ _label?: string;
  /** @internal */ _icon?: string;
  /** @internal */ _fields: Field[] = [];

  constructor(name: string) {
    this.name = name;
  }

  label(label: string): this {
    this._label = label;
    return this;
  }

  icon(name: string): this {
    this._icon = name;
    return this;
  }

  schema(fields: Field[]): this {
    this._fields = fields;
    return this;
  }

  getLabel(): string {
    return this._label ?? titleCase(this.name);
  }
}

/** Declare a block type a builder field can offer. */
export function builderBlock(name: string): BuilderBlock {
  return new BuilderBlock(name);
}

/** A permissive view of a validator rule (methods vary by base type). */
interface AnyRule {
  required(message?: string): AnyRule;
  optional(): AnyRule;
  email?(message?: string): AnyRule;
  url?(message?: string): AnyRule;
  min?(n: number, message?: string): AnyRule;
  max?(n: number, message?: string): AnyRule;
  confirmed?(message?: string): AnyRule;
  in?(values: string[], message?: string): AnyRule;
}

export class Field {
  /** @internal */ _key: string;
  /** @internal */ _label?: string;
  /** @internal */ _type: FieldType = "text";
  /** @internal */ _required = false;
  /** @internal */ _placeholder?: string;
  /** @internal */ _helper?: string;
  /** @internal */ _default?: unknown;
  /** @internal */ _disabled = false;
  /** @internal */ _columnSpan = 1;
  /** @internal */ _minLength?: number;
  /** @internal */ _maxLength?: number;
  /** @internal */ _min?: number;
  /** @internal */ _max?: number;
  /** @internal */ _confirmed = false;
  /** @internal */ _options?: SelectOption[];
  /** @internal */ _optionsLoader?: () => Promise<SelectOption[]> | SelectOption[];
  /** @internal */ _rows = 4;
  /** @internal */ _autocomplete?: string;
  /** @internal */ _visibleOn?: FieldMode[];
  /** @internal */ _rule?: (rule: AnyRule) => AnyRule;
  /** @internal */ _mutate?: (value: unknown) => unknown | Promise<unknown>;
  /** @internal */ _multiple = false;
  /** @internal */ _searchable = false;
  /** @internal */ _step?: number;
  /** @internal */ _visibleFn?: FieldPredicate;
  /** @internal */ _disabledFn?: FieldPredicate;
  /** @internal Allow values not in `options` (free entry on a searchable select). */
  _createOption = false;
  /** @internal Re-render on every change so dependent fields update. */
  _live = false;
  /** @internal Reactive hook — return a patch merged into the form on change. */
  _afterUpdate?: (value: unknown, data: Record<string, unknown>) => Record<string, unknown> | void;
  /** @internal File upload: target storage directory/disk path. */
  _uploadDir = "uploads";
  /** @internal File upload: `accept` attribute. */
  _accept?: string;
  /** @internal Repeater sub-schema — the fields repeated for each row. */
  _subfields: Field[] = [];
  /** @internal Builder block definitions (each a named, labelled sub-schema). */
  _blocks: BuilderBlock[] = [];
  /** @internal A custom control, replacing every built-in field type. */
  _render?: (value: unknown, data: Record<string, unknown>) => HtmlNode | string;
  /** @internal Label for the repeater/builder "add" button. */
  _addLabel?: string;
  /** @internal Minimum number of repeater/builder rows. */
  _minItems?: number;
  /** @internal Maximum number of repeater/builder rows. */
  _maxItems?: number;
  /** @internal Whether repeater/builder rows can be reordered. */
  _reorderable = true;
  /** @internal Title each repeater/builder row (collapsed header). */
  _itemLabel?: (data: Record<string, unknown>, index: number) => string;

  constructor(key: string, type: FieldType = "text") {
    this._key = key;
    this._type = type;
  }

  static make(key: string): Field {
    return new Field(key);
  }

  // ── Identity ─────────────────────────────────────────────────────────────

  label(label: string): this {
    this._label = label;
    return this;
  }

  placeholder(text: string): this {
    this._placeholder = text;
    return this;
  }

  /** Hint text shown beneath the input. */
  helperText(text: string): this {
    this._helper = text;
    return this;
  }

  default(value: unknown): this {
    this._default = value;
    return this;
  }

  disabled(value = true): this {
    this._disabled = value;
    return this;
  }

  columnSpan(span: number): this {
    this._columnSpan = Math.max(1, span);
    return this;
  }

  autocomplete(value: string): this {
    this._autocomplete = value;
    return this;
  }

  // ── Type modifiers ───────────────────────────────────────────────────────

  email(): this {
    this._type = "email";
    return this;
  }

  password(): this {
    this._type = "password";
    return this;
  }

  numeric(): this {
    this._type = "number";
    return this;
  }

  url(): this {
    this._type = "url";
    return this;
  }

  tel(): this {
    this._type = "tel";
    return this;
  }

  /** Render as an on/off toggle switch (boolean). */
  toggle(): this {
    this._type = "toggle";
    return this;
  }

  /** Render as a radio group (single choice from `options`). */
  radio(): this {
    this._type = "radio";
    return this;
  }

  /** Render as a list of checkboxes (multi-select → array of values). */
  checkboxList(): this {
    this._type = "checkboxList";
    this._multiple = true;
    return this;
  }

  /** Native date picker (`<input type="date">`). */
  date(): this {
    this._type = "date";
    return this;
  }

  /** Native date-time picker (`<input type="datetime-local">`). */
  dateTime(): this {
    this._type = "datetime";
    return this;
  }

  /** Native time picker (`<input type="time">`). */
  time(): this {
    this._type = "time";
    return this;
  }

  /** Native color picker (`<input type="color">`). */
  color(): this {
    this._type = "color";
    return this;
  }

  /** Hidden field — kept in form state, not shown. */
  hidden(): this {
    this._type = "hidden";
    return this;
  }

  /** Token/tags input → array of strings. */
  tags(): this {
    this._type = "tags";
    return this;
  }

  /** Key/value editor → an object. */
  keyValue(): this {
    this._type = "keyValue";
    return this;
  }

  /** File upload — stores the file on save and persists the path. */
  file(): this {
    this._type = "file";
    return this;
  }

  /** Storage directory/disk for a file upload (passed to `TemporaryUploadedFile.store`). */
  disk(dir: string): this {
    this._uploadDir = dir;
    return this;
  }

  /** Restrict accepted file types (the input's `accept` attribute). */
  accept(mime: string): this {
    this._accept = mime;
    return this;
  }

  /** Shorthand for an image upload (`accept="image/*"`). */
  image(): this {
    this._type = "file";
    this._accept = "image/*";
    return this;
  }

  /** Allow selecting multiple values (select → array; rendered as a checkbox list). */
  multiple(value = true): this {
    this._multiple = value;
    return this;
  }

  /** Make a select searchable (renders a filterable `<datalist>` combobox). */
  searchable(value = true): this {
    this._searchable = value;
    return this;
  }

  /** Allow choosing a value not in `options` (free entry; skips the one-of rule). */
  createOption(value = true): this {
    this._createOption = value;
    this._searchable = true;
    return this;
  }

  /** Re-evaluate dependent fields on every change to this field. */
  live(value = true): this {
    this._live = value;
    return this;
  }

  /**
   * Reactive hook, run on the server when this
   * field changes; return an object to merge into the form (e.g. derive a slug):
   *
   *   textInput("title").live()
   *     .afterStateUpdated((v) => ({ slug: String(v).toLowerCase().replace(/\\s+/g, "-") }))
   */
  afterStateUpdated(
    fn: (value: unknown, data: Record<string, unknown>) => Record<string, unknown> | void,
  ): this {
    this._afterUpdate = fn;
    this._live = true;
    return this;
  }

  /** Numeric step for number/range inputs. */
  step(n: number): this {
    this._step = n;
    return this;
  }

  // ── Repeater / Builder (nested object-arrays) ──────────────────────────────

  /** The sub-schema repeated for each row of a {@link repeater}. */
  schema(fields: Field[]): this {
    this._subfields = fields;
    return this;
  }

  /** The block types available in a {@link builder}. */
  blocks(blocks: BuilderBlock[]): this {
    this._blocks = blocks;
    return this;
  }

  /** Custom label for the repeater/builder "add" button. */
  addActionLabel(label: string): this {
    this._addLabel = label;
    return this;
  }

  /** Minimum number of repeater/builder rows. */
  minItems(n: number): this {
    this._minItems = Math.max(0, n);
    return this;
  }

  /** Maximum number of repeater/builder rows. */
  maxItems(n: number): this {
    this._maxItems = Math.max(1, n);
    return this;
  }

  /** Allow (or forbid) reordering repeater/builder rows. */
  reorderable(value = true): this {
    this._reorderable = value;
    return this;
  }

  /** Title each repeater/builder row from its data (shown in the row header). */
  itemLabel(fn: (data: Record<string, unknown>, index: number) => string): this {
    this._itemLabel = fn;
    return this;
  }

  /** Rows for a textarea. */
  rows(n: number): this {
    this._rows = Math.max(1, n);
    return this;
  }

  /**
   * Render this field's control yourself. See {@link customField}.
   *
   * The renderer receives the current value and the whole form's data, so a
   * control can react to its siblings — a district picker that depends on the
   * country chosen above it.
   */
  render(fn: (value: unknown, data: Record<string, unknown>) => HtmlNode | string): this {
    this._render = fn;
    return this;
  }

  /** Options for a select — `{ value: label }` map or an array of `{value,label}`. */
  options(options: Record<string, string> | SelectOption[]): this {
    this._options = Array.isArray(options)
      ? options
      : Object.entries(options).map(([value, label]) => ({ value, label }));
    return this;
  }

  /**
   * Load select options dynamically (e.g. a BelongsTo relationship). The loader
   * runs each render; return `{ value, label }[]`.
   *
   *   select("userId").label("Author")
   *     .optionsUsing(async () => (await User.all()).map((u) => ({ value: String(u.id), label: u.name })))
   */
  optionsUsing(loader: () => Promise<SelectOption[]> | SelectOption[]): this {
    this._type = "select";
    this._optionsLoader = loader;
    return this;
  }

  // ── Validation ───────────────────────────────────────────────────────────

  required(value = true): this {
    this._required = value;
    return this;
  }

  /** Min length (string) / min value (number). */
  minLength(n: number): this {
    this._minLength = n;
    return this;
  }

  maxLength(n: number): this {
    this._maxLength = n;
    return this;
  }

  min(n: number): this {
    this._min = n;
    return this;
  }

  max(n: number): this {
    this._max = n;
    return this;
  }

  /** Require a matching `{key}_confirmation` field (e.g. password). */
  confirmed(value = true): this {
    this._confirmed = value;
    return this;
  }

  /** Append a custom validator rule. */
  rule(fn: (rule: AnyRule) => AnyRule): this {
    this._rule = fn;
    return this;
  }

  /**
   * Transform the value just before it is saved — the counterpart to
   * {@link Field.hydrate}. May be async, e.g. hashing a password:
   * `.mutate((v) => Hash.make(v))`.
   */
  mutate(fn: (value: unknown) => unknown | Promise<unknown>): this {
    this._mutate = fn;
    return this;
  }

  /**
   * Coerce an empty optional value so nullable columns don't choke on `""`.
   *
   * A blank `datePicker`/`select`/`numeric` field submits the empty string, which
   * a date/number/foreign-key cast can't parse (`Cannot parse date: ""`). For the
   * types where `""` is never a valid stored value we map blank → `null`, and we
   * parse numeric strings to real numbers. Text-like fields are left untouched
   * (an empty string is a legitimate value for a `NOT NULL DEFAULT ''` column).
   * Required fields are never coerced — validation has already rejected a blank.
   */
  private _coerceEmpty(value: unknown): unknown {
    const blank =
      value === "" || (typeof value === "string" && value.trim() === "") || value === undefined;
    const nullableTypes: FieldType[] = [
      "date",
      "datetime",
      "time",
      "number",
      "slider",
      "select",
      "radio",
      "color",
    ];
    if (blank && !this._required && nullableTypes.includes(this._type) && !this.isArrayValued()) {
      return null;
    }
    if (
      (this._type === "number" || this._type === "slider") &&
      typeof value === "string" &&
      value.trim() !== ""
    ) {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    return value;
  }

  /**
   * Apply this field's save-time transform: serialize key/value text → object,
   * persist any pending file upload(s) → stored path, then run a custom mutator.
   */
  async dehydrate(value: unknown): Promise<unknown> {
    let v = this._coerceEmpty(value);
    if (this._type === "keyValue" && typeof v === "string") v = parseKeyValueLines(v);
    if (this._type === "file") v = await storeUploads(v, this._uploadDir);
    // Strip the internal `__id` (repeater) / `__id`+`__type` (builder → `{type,data}`).
    if (this._type === "repeater" && Array.isArray(v)) {
      v = v.map((row) => {
        const { __id: _id, ...rest } = row as Record<string, unknown>;
        return rest;
      });
    }
    if (this._type === "builder" && Array.isArray(v)) {
      v = v.map((row) => {
        const { __id: _id, __type, ...rest } = row as Record<string, unknown>;
        return { type: __type, data: rest };
      });
    }
    return this._mutate ? await this._mutate(v) : v;
  }

  // ── Visibility per mode ──────────────────────────────────────────────────

  /** Only show this field when creating / editing. */
  visibleOn(...modes: FieldMode[]): this {
    this._visibleOn = modes;
    return this;
  }

  /** Hide this field when creating / editing. */
  hiddenOn(...modes: FieldMode[]): this {
    const all: FieldMode[] = ["create", "edit"];
    this._visibleOn = all.filter((m) => !modes.includes(m));
    return this;
  }

  /** Reactively show this field only when `fn(formData)` is true. */
  visible(fn: FieldPredicate): this {
    this._visibleFn = fn;
    return this;
  }

  /** Reactively disable this field when `fn(formData)` is true. */
  disabledWhen(fn: FieldPredicate): this {
    this._disabledFn = fn;
    return this;
  }

  // ── Resolution ───────────────────────────────────────────────────────────

  getLabel(): string {
    return this._label ?? titleCase(this._key);
  }

  visibleIn(mode: FieldMode): boolean {
    return this._visibleOn ? this._visibleOn.includes(mode) : true;
  }

  /** Reactive visibility for the current form data (combines with `visibleIn`). */
  visibleForData(data: Record<string, unknown>): boolean {
    return this._visibleFn ? this._visibleFn(data) : true;
  }

  /** Whether the field is disabled for the current form data. */
  isDisabledFor(data: Record<string, unknown>): boolean {
    if (this._disabled) return true;
    return this._disabledFn ? this._disabledFn(data) : false;
  }

  /** True for array-valued fields (checkbox list / tags / multiple select / multiple file). */
  isArrayValued(): boolean {
    return (
      this._type === "checkboxList" ||
      this._type === "tags" ||
      (this._type === "select" && this._multiple) ||
      (this._type === "file" && this._multiple) ||
      (this._type === "toggleButtons" && this._multiple)
    );
  }

  /** Initial value for the generated form. */
  defaultValue(): unknown {
    if (this._default !== undefined) return this._default;
    if (this._type === "repeater" || this._type === "builder") return [];
    if (this._type === "file") return this._multiple ? [] : null;
    if (this._type === "keyValue") return "";
    if (this.isArrayValued()) return [];
    if (this._type === "checkbox" || this._type === "toggle") return false;
    if (this._type === "slider") return this._min ?? 0;
    return "";
  }

  /** Transform a stored record value into form state when filling the Edit form. */
  hydrate(value: unknown): unknown {
    if (this._type === "keyValue" && value && typeof value === "object") {
      return keyValueToLines(value as Record<string, unknown>);
    }
    if (this._type === "tags" && typeof value === "string") {
      return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    // Repeater rows gain a stable `__id` for keyed reorder/remove + draft binding.
    if (this._type === "repeater" && Array.isArray(value)) {
      return value.map((row, i) => ({ __id: i + 1, ...(row as Record<string, unknown>) }));
    }
    // Builder rows are stored as `{ type, data }`; flatten into `{ __id, __type, ...data }`.
    if (this._type === "builder" && Array.isArray(value)) {
      return value.map((row, i) => {
        const r = (row ?? {}) as { type?: string; data?: Record<string, unknown> };
        return { __id: i + 1, __type: r.type ?? "", ...(r.data ?? {}) };
      });
    }
    return value;
  }

  /** Build this field's validation rule on the shared {@link RuleBuilder}. */
  buildRule(v: RuleBuilder): FieldRule {
    const vAny = v as unknown as {
      number(): AnyRule;
      boolean(): AnyRule;
      string(): AnyRule;
      // The validator's array() needs an element rule (array(itemRule)).
      array?(item: AnyRule): AnyRule;
    };
    /** Array rule over string elements (tags, checkbox-list, multi-select, …). */
    const arrayRule = (): AnyRule => (vAny.array ? vAny.array(vAny.string()) : vAny.string());

    // File uploads hold temp-file objects → text validators can't model them.
    if (this._type === "file") {
      const rf = vAny.string().optional();
      return (this._rule ? this._rule(rf) : rf) as unknown as FieldRule;
    }

    // Repeater/builder hold arrays of objects — sub-fields validate per-row in
    // the page; the top-level rule stays lenient (optional array).
    if (this._type === "repeater" || this._type === "builder") {
      const ra = arrayRule().optional();
      return (this._rule ? this._rule(ra) : ra) as unknown as FieldRule;
    }

    let r: AnyRule;
    if (this._type === "number" || this._type === "slider") r = vAny.number();
    else if (this._type === "checkbox" || this._type === "toggle") r = vAny.boolean();
    else if (this.isArrayValued()) r = arrayRule();
    else r = vAny.string();

    // Array fields without native `array()` support stay optional to avoid a
    // spurious "must be a string" failure against an array value.
    const lenientArray = this.isArrayValued() && !vAny.array;
    r = this._required && !lenientArray ? r.required() : r.optional();

    if (this._type === "email" && r.email) r = r.email();
    if (this._type === "url" && r.url) r = r.url();
    const numeric = this._type === "number" || this._type === "slider";
    if (!this.isArrayValued() && !numeric && this._type !== "keyValue") {
      if (this._minLength != null && r.min) r = r.min(this._minLength);
      if (this._maxLength != null && r.max) r = r.max(this._maxLength);
    }
    if (numeric) {
      if (this._min != null && r.min) r = r.min(this._min);
      if (this._max != null && r.max) r = r.max(this._max);
    }
    if (this._confirmed && r.confirmed) r = r.confirmed();
    // `in` (one-of) applies to restricted single-choice fields (not free-entry).
    if (
      !this.isArrayValued() &&
      !this._createOption &&
      this._options &&
      this._options.length > 0 &&
      r.in
    ) {
      r = r.in(this._options.map((o) => String(o.value)));
    }
    if (this._rule) r = this._rule(r);
    return r as unknown as FieldRule;
  }
}

/** A single-line text input. */
export function textInput(key: string): Field {
  return new Field(key, "text");
}

/** A multi-line text input. */
export function textarea(key: string): Field {
  return new Field(key, "textarea");
}

/** A single-choice dropdown. */
export function select(key: string): Field {
  return new Field(key, "select");
}

/** A single checkbox → boolean. */
export function checkbox(key: string): Field {
  return new Field(key, "checkbox");
}

/** On/off switch. */
export function toggle(key: string): Field {
  return new Field(key, "toggle");
}

/** Single-choice radio group. */
export function radio(key: string): Field {
  return new Field(key, "radio");
}

/** Multi-choice checkbox list → array value. */
export function checkboxList(key: string): Field {
  return new Field(key, "checkboxList").checkboxList();
}

/** Native date picker. */
export function datePicker(key: string): Field {
  return new Field(key, "date");
}

/** Native date-time picker. */
export function dateTimePicker(key: string): Field {
  return new Field(key, "datetime");
}

/** Native time picker. */
export function timePicker(key: string): Field {
  return new Field(key, "time");
}

/** Native color picker. */
export function colorPicker(key: string): Field {
  return new Field(key, "color");
}

/** Hidden field retained in form state. */
export function hidden(key: string): Field {
  return new Field(key, "hidden");
}

/** Tags / tokens input → array of strings. */
export function tagsInput(key: string): Field {
  return new Field(key, "tags");
}

/** Key/value editor → object. */
export function keyValue(key: string): Field {
  return new Field(key, "keyValue");
}

/** File upload. Stores the file on save and persists the path. */
export function fileUpload(key: string): Field {
  return new Field(key, "file");
}

/**
 * Pick a file from the media library, or upload a new one into it.
 *
 * The difference from {@link fileUpload} is reuse: an upload field puts a file
 * somewhere and forgets it, while this one catalogues what it stores, so the
 * same image can be chosen again from anywhere in the panel. Needs a media
 * provider on the panel; without one it behaves as a plain upload.
 */
export function mediaPicker(key: string): Field {
  return new Field(key, "media");
}

/** Range slider → number. Pair with `.min()/.max()/.step()`. */
export function slider(key: string): Field {
  return new Field(key, "slider");
}

/** Segmented toggle buttons. `.options()` + optional `.multiple()`. */
export function toggleButtons(key: string): Field {
  return new Field(key, "toggleButtons");
}

/** Monospace code editor with tab support. */
export function codeEditor(key: string): Field {
  return new Field(key, "code");
}

/** Markdown editor — a textarea with a formatting toolbar. */
export function markdownEditor(key: string): Field {
  return new Field(key, "markdown");
}

/** Rich text (WYSIWYG) editor → HTML. */
export function richEditor(key: string): Field {
  return new Field(key, "richText");
}

/**
 * Repeater → array of objects sharing one sub-schema.
 * Add/remove/reorder rows; each row's fields bind through a flat draft:
 *
 *   repeater("contacts").schema([
 *     textInput("name").required(),
 *     textInput("email").email(),
 *   ]).minItems(1).addActionLabel("Add contact")
 */
export function repeater(key: string): Field {
  return new Field(key, "repeater");
}

/**
 * Builder → array of typed blocks, each with its own schema. Declare the
 * block types with {@link builderBlock}. Stored as `[{ type, data }]`:
 *
 *   builder("content").blocks([
 *     builderBlock("paragraph").schema([textarea("text")]),
 *     builderBlock("image").icon("photo").schema([fileUpload("src").image()]),
 *   ])
 */
export function builder(key: string): Field {
  return new Field(key, "builder");
}

/**
 * A control you render yourself, when nothing in the catalogue fits — a map
 * picker, a colour-ramp editor, a signature pad.
 *
 *   customField("coordinates").render((value) => <MapPicker value={value} />)
 *
 * The renderer owns the control; the field still owns the label, helper text,
 * validation rules and the `form.<key>` binding, so a custom control saves and
 * validates like any other. Bind your markup to `form.<key>` for the value to
 * round-trip.
 */
export function customField(key: string): Field {
  return new Field(key, "custom");
}

// ── Serialization helpers ───────────────────────────────────────────────────────

/** Parse a `key: value` (one per line) textarea into an object. */
function parseKeyValueLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) {
      out[trimmed] = "";
      continue;
    }
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

/** Render an object back into `key: value` lines for editing. */
function keyValueToLines(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${v ?? ""}`)
    .join("\n");
}

/** A pending upload exposes an async `store(dir)` that returns the stored path. */
interface StorableUpload {
  store(dir: string): Promise<string>;
}
function isStorable(v: unknown): v is StorableUpload {
  return !!v && typeof (v as { store?: unknown }).store === "function";
}

/** Persist any pending upload(s) and replace them with their stored path(s). */
async function storeUploads(value: unknown, dir: string): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => (isStorable(v) ? v.store(dir) : v)));
  }
  return isStorable(value) ? value.store(dir) : value;
}

function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
