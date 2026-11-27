/**
 * Reading a server-rendered page in a test: find what is on it, and assert on what a visitor
 * would see — text, fields, links, forms — with failures that say what the page held instead.
 *
 * A page rendered as HTML reaches a test as markup, not as a component name and its props. So
 * a test reads it the way a visitor does: by the text on it, the role and name of each control,
 * a field by its label or name. That keeps a test passing while the classes and the nesting
 * around a value change, and needs no attribute added to the markup only for tests.
 *
 * Every query works on the whole page ({@link HtmlDocument}) or inside one element of it
 * ({@link HtmlElement}), so a test can narrow to a form or a list and ask the same questions.
 */
import { _byId, _isHiddenFromA11y, _levelOf, _nameOf, _roleOf } from "./a11y.ts";
import { _matches, _select } from "./selector.ts";
import {
  _attr,
  _childElements,
  _collapse,
  _descendants,
  _innerHtml,
  _isVisible,
  _outerHtml,
  _parseHtml,
  _rootOf,
  _startTag,
  _visibleText,
  type _Element,
} from "./tree.ts";

/** Text to look for: a string compared after whitespace is collapsed, or a pattern. */
export type TextMatch = string | RegExp;

/** Options for {@link HtmlScope.findAllByRole} and the queries beside it. */
export interface ByRoleOptions {
  /** The accessible name: what a screen reader announces. A string must match it exactly. */
  name?: TextMatch | undefined;
  /** For headings, the level: `1` for an `<h1>`. */
  level?: number | undefined;
  /** Include elements hidden from assistive technology (`hidden`, `aria-hidden="true"`). */
  hidden?: boolean | undefined;
}

/** Options for {@link HtmlScope.findAllByText} and the queries beside it. */
export interface ByTextOptions {
  /**
   * `true` (the default): a string must be the element's whole text. `false`: the text need
   * only contain it, ignoring case.
   */
  exact?: boolean | undefined;
  /** Only elements matching this CSS selector count. */
  selector?: string | undefined;
}

/** A value an assertion compares a field's value with. */
type FieldValue = string | number;

/** How much of the page's text a failure quotes. */
const TEXT_LIMIT = 800;
/** How many candidates a failure lists. */
const LIST_LIMIT = 15;

const CONTROLS = new Set(["input", "select", "textarea"]);

/**
 * The queries and assertions shared by a whole page and by one element of it.
 *
 * Queries come in three shapes. `find…` returns the first match or `null`, `findAll…` every
 * match (possibly none), and `get…` the first match, throwing with what the page held when
 * there is none. Assertions return `this`, so they chain.
 */
export abstract class HtmlScope {
  /** @internal */
  protected readonly _node: _Element;
  /** @internal */
  protected readonly _note: string | undefined;

  /** @internal */
  protected constructor(node: _Element, note?: string) {
    this._node = node;
    this._note = note;
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  /**
   * The text a visitor reads here: no scripts, styles or `hidden` elements, a space between
   * blocks, and whitespace collapsed.
   */
  text(): string {
    return _visibleText(this._node);
  }

  /** The markup, rebuilt from the parsed tree. */
  abstract html(): string;

  // ── CSS selectors ────────────────────────────────────────────────────────

  /** The first element matching a CSS selector, or `null`. */
  find(selector: string): HtmlElement | null {
    const [first] = _select(this._node, selector);
    return first ? this._wrap(first) : null;
  }

  /** Every element matching a CSS selector, in document order. */
  findAll(selector: string): HtmlElement[] {
    return _select(this._node, selector).map((node) => this._wrap(node));
  }

  /** The first element matching a CSS selector. Throws, showing the page, when nothing does. */
  get(selector: string): HtmlElement {
    const found = this.find(selector);
    if (!found) this._fail(`Expected an element matching "${selector}", but none is here.`);
    return found!;
  }

  /** How many elements match a CSS selector. */
  count(selector: string): number {
    return _select(this._node, selector).length;
  }

  // ── Roles ────────────────────────────────────────────────────────────────

  /**
   * Every element with this role — its `role` attribute, or the one its tag implies (`button`,
   * `link`, `heading`, `textbox`, `checkbox`, `list`, `listitem`, `row`, `group`, …) —
   * optionally with this accessible name.
   *
   * @example
   * page.findAllByRole("link", { name: /^Edit / });
   */
  findAllByRole(role: string, options: ByRoleOptions = {}): HtmlElement[] {
    return this._byRole(role, options).map((node) => this._wrap(node));
  }

  /** The first element with this role (and name), or `null`. */
  findByRole(role: string, options: ByRoleOptions = {}): HtmlElement | null {
    const [first] = this._byRole(role, options);
    return first ? this._wrap(first) : null;
  }

  /**
   * The first element with this role (and name). Throws when there is none, listing what does
   * have that role.
   *
   * @example
   * page.getByRole("button", { name: "Save" });
   */
  getByRole(role: string, options: ByRoleOptions = {}): HtmlElement {
    const found = this.findByRole(role, options);
    if (found) return found;
    const wanted = describeRole(role, options);
    const others = this._byRole(role, { hidden: options.hidden });
    if (others.length > 0) {
      this._fail(
        `Expected ${wanted}, but none is here.`,
        `With the role "${role}":`,
        others.map((node) => describeNamed(node)),
      );
    }
    this._fail(`Expected ${wanted}, but nothing here has that role.`, "Roles here:", this._roles());
  }

  // ── Text ─────────────────────────────────────────────────────────────────

  /**
   * The elements whose visible text matches, innermost first: the `<span>` that says "On",
   * not every element around it.
   */
  findAllByText(text: TextMatch, options: ByTextOptions = {}): HtmlElement[] {
    return this._byText(text, options).map((node) => this._wrap(node));
  }

  /** The first element whose visible text matches, or `null`. */
  findByText(text: TextMatch, options: ByTextOptions = {}): HtmlElement | null {
    const [first] = this._byText(text, options);
    return first ? this._wrap(first) : null;
  }

  /** The first element whose visible text matches. Throws, showing the page, when none does. */
  getByText(text: TextMatch, options: ByTextOptions = {}): HtmlElement {
    const found = this.findByText(text, options);
    if (!found) {
      const how = options.exact === false || text instanceof RegExp ? "matching" : "reading";
      const where = options.selector ? ` (among "${options.selector}")` : "";
      this._fail(`Expected an element ${how} ${show(text)}${where}, but none is here.`);
    }
    return found!;
  }

  // ── Fields and forms ─────────────────────────────────────────────────────

  /** The form controls labelled with this text: by `<label>`, `aria-label` or `aria-labelledby`. */
  findAllByLabel(text: TextMatch): HtmlElement[] {
    return this._controls()
      .filter((node) => !isHiddenInput(node) && matchText(_nameOf(node), text))
      .map((node) => this._wrap(node));
  }

  /** The first form control labelled with this text, or `null`. */
  findByLabel(text: TextMatch): HtmlElement | null {
    return this.findAllByLabel(text)[0] ?? null;
  }

  /** The first form control labelled with this text. Throws, listing the fields, when none is. */
  getByLabel(text: TextMatch): HtmlElement {
    const found = this.findByLabel(text);
    if (!found) {
      this._fail(`Expected a field labelled ${show(text)}, but none is here.`, "Fields here:", [
        ...this._fieldList(),
      ]);
    }
    return found!;
  }

  /**
   * A form control, by its `name`, its `id`, or its label — in that order. Throws, listing the
   * fields, when none matches. For a group of radios or checkboxes, the first of them.
   *
   * @example
   * page.field("email").value();
   * page.field("Email address").attr("type");
   */
  field(field: string): HtmlElement {
    const [first] = this._field(field);
    return this._wrap(first!);
  }

  /**
   * A form, by its `action` — the URL it sends to, as written in the markup. With no action
   * given, the first form. Throws, listing the forms, when none matches.
   *
   * @example
   * page.form("/settings/password").assertValue("current_password", "");
   */
  form(action?: string | RegExp): HtmlElement {
    const forms = _descendants(this._node).filter((node) => node.tag === "form");
    const found =
      action === undefined ? forms[0] : forms.find((node) => urlMatches(formAction(node), action));
    if (!found) {
      this._fail(
        action === undefined
          ? "Expected a form, but none is here."
          : `Expected a form sending to ${show(action)}, but none is here.`,
        "Forms here:",
        forms.map(describeForm),
      );
    }
    return this._wrap(found!);
  }

  // ── Assertions ───────────────────────────────────────────────────────────

  /** Assert a visitor can read this text here (see {@link text}). */
  assertSeeText(text: TextMatch): this {
    if (!matchText(this.text(), text, false, true)) {
      this._fail(`Expected to see ${show(text)}, but it is not here.`);
    }
    return this;
  }

  /** Assert a visitor cannot read this text here. */
  assertDontSeeText(text: TextMatch): this {
    if (matchText(this.text(), text, false, true)) {
      this._fail(`Expected not to see ${show(text)}, but it is here.`);
    }
    return this;
  }

  /** Assert at least one element matches a CSS selector. */
  assertPresent(selector: string): this {
    this.get(selector);
    return this;
  }

  /** Assert no element matches a CSS selector. */
  assertMissing(selector: string): this {
    const found = _select(this._node, selector);
    if (found.length > 0) {
      this._fail(
        `Expected nothing to match "${selector}", but ${plural(found.length, "element")} do:`,
        null,
        found.map(describeElement),
      );
    }
    return this;
  }

  /** Assert exactly `count` elements match a CSS selector. */
  assertCount(selector: string, count: number): this {
    const found = _select(this._node, selector);
    if (found.length !== count) {
      this._fail(
        `Expected ${plural(count, "element")} to match "${selector}", but ${found.length} do.`,
        found.length > 0 ? "Matched:" : null,
        found.map(describeElement),
      );
    }
    return this;
  }

  /**
   * Assert a field holds this value, as the page was sent: an input's `value`, a textarea's
   * text, a select's chosen option. For a group of radios, the value of the checked one.
   *
   * @example
   * res.html().assertValue("email", "ada@example.com");
   */
  assertValue(field: string, value: FieldValue): this {
    const group = this._field(field);
    const first = group[0]!;
    const radio = first.tag === "input" && (_attr(first, "type") ?? "").toLowerCase() === "radio";
    const checked = radio ? group.find((node) => _attr(node, "checked") !== null) : undefined;
    const actual = radio ? (checked ? fieldValue(checked) : null) : fieldValue(first);
    if (actual !== String(value)) {
      this._fail(
        `Expected the field "${field}" to hold "${value}", but ` +
          (actual === null ? "none of its options is checked." : `it holds "${actual}".`),
        "The field:",
        (radio ? group : [first]).map(describeElement),
      );
    }
    return this;
  }

  /**
   * Assert a checkbox or radio is checked. With `value`, the one of that name with that value:
   * `assertChecked("status", "active")`.
   */
  assertChecked(field: string, value?: FieldValue): this {
    const control = this._checkable(field, value);
    if (_attr(control, "checked") === null) {
      this._fail(
        `Expected ${describeCheckable(field, value)} to be checked, but it is not.`,
        null,
        [describeElement(control)],
      );
    }
    return this;
  }

  /** Assert a checkbox or radio is not checked. */
  assertNotChecked(field: string, value?: FieldValue): this {
    const control = this._checkable(field, value);
    if (_attr(control, "checked") !== null) {
      this._fail(
        `Expected ${describeCheckable(field, value)} not to be checked, but it is.`,
        null,
        [describeElement(control)],
      );
    }
    return this;
  }

  /**
   * Assert a field shows a validation error, optionally one containing `message`.
   *
   * The error is read the way assistive technology reads it: the field is marked
   * `aria-invalid="true"`, and the error is the visible text its `aria-errormessage` or
   * `aria-describedby` points to. A field whose error is only coloured red has none to find.
   *
   * @example
   * res.html().assertFieldError("email", "The email field is required.");
   */
  assertFieldError(field: string, message?: string): this {
    const control = this._field(field)[0]!;
    const { invalid, messages } = fieldErrors(control);
    if (!invalid && messages.length === 0) {
      this._fail(`Expected the field "${field}" to show an error, but it shows none.`, null, [
        describeElement(control),
      ]);
    }
    if (message !== undefined && !messages.some((text) => text.includes(message))) {
      this._fail(
        `Expected the field "${field}" to show the error "${message}", but ` +
          (messages.length === 0
            ? "it is marked invalid with no message."
            : `it shows ${messages.map((text) => `"${text}"`).join(", ")}.`),
      );
    }
    return this;
  }

  /** Assert a field shows no validation error. */
  assertNoFieldError(field: string): this {
    const control = this._field(field)[0]!;
    const { invalid, messages } = fieldErrors(control);
    if (invalid || messages.length > 0) {
      this._fail(
        `Expected the field "${field}" to show no error, but it shows ` +
          (messages.length > 0 ? messages.map((text) => `"${text}"`).join(", ") : "it is invalid") +
          ".",
      );
    }
    return this;
  }

  /**
   * Assert a link with this accessible name points to `href`. A path matches an absolute URL
   * with that path, so `"/projects"` matches `http://localhost/projects`.
   *
   * @example
   * res.html().assertLink("Forgot your password?", "/forgot-password");
   */
  assertLink(name: TextMatch, href: string | RegExp): this {
    const links = this._byRole("link", { name });
    if (links.some((node) => urlMatches(_attr(node, "href") ?? "", href))) return this;
    const all = this._byRole("link", {});
    this._fail(
      links.length === 0
        ? `Expected a link ${show(name)} to ${show(href)}, but there is no link ${show(name)}.`
        : `Expected the link ${show(name)} to point to ${show(href)}, but it points to ` +
            `${links.map((node) => `"${_attr(node, "href")}"`).join(", ")}.`,
      links.length === 0 ? "Links here:" : null,
      links.length === 0 ? all.map(describeLink) : [],
    );
  }

  /**
   * Assert a form here sends to `action`, optionally with `method`: the form's `method`
   * attribute, `GET` when it has none, compared ignoring case.
   *
   * @example
   * res.html().assertFormAction("/logout", "POST");
   */
  assertFormAction(action: string | RegExp, method?: string): this {
    const forms = _descendants(this._node).filter((node) => node.tag === "form");
    const matching = forms.filter((node) => urlMatches(formAction(node), action));
    const wanted = method?.toUpperCase();
    if (matching.length > 0 && (!wanted || matching.some((node) => formMethod(node) === wanted))) {
      return this;
    }
    this._fail(
      `Expected a form sending ${wanted ? `${wanted} ` : ""}to ${show(action)}, but ` +
        (matching.length > 0
          ? `it sends ${matching.map(formMethod).join(", ")}.`
          : "there is none."),
      "Forms here:",
      forms.map(describeForm),
    );
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** @internal Wrap a node of this tree as an element view. */
  protected _wrap(node: _Element): HtmlElement {
    return HtmlElement._of(node, this._note);
  }

  /** @internal What a failure says this scope is. */
  protected abstract _describe(): string;

  /** @internal Throw, with the scope's text and an optional list of what was here. */
  protected _fail(message: string, heading?: string | null, items: string[] = []): never {
    const parts = [message];
    if (this._note) parts.push(this._note);
    if (items.length > 0) {
      const shown = items.slice(0, LIST_LIMIT).map((item) => `  ${item}`);
      if (items.length > LIST_LIMIT) shown.push(`  … and ${items.length - LIST_LIMIT} more`);
      parts.push(`${heading ? `\n${heading}\n` : ""}${shown.join("\n")}`);
    }
    const text = this.text();
    parts.push(`\n${this._describe()}:\n  ${text ? truncate(text, TEXT_LIMIT) : "<no text>"}`);
    throw new Error(parts.join("\n"));
  }

  private _byRole(role: string, options: ByRoleOptions): _Element[] {
    return _descendants(this._node).filter(
      (node) =>
        _roleOf(node) === role &&
        (options.hidden === true || !_isHiddenFromA11y(node)) &&
        (options.level === undefined || _levelOf(node) === options.level) &&
        (options.name === undefined || matchText(_nameOf(node), options.name)),
    );
  }

  private _byText(text: TextMatch, options: ByTextOptions): _Element[] {
    const exact = options.exact !== false;
    const candidates = _descendants(this._node).filter(
      (node) =>
        _isVisible(node) &&
        (options.selector === undefined || _matches(node, options.selector)) &&
        matchText(_visibleText(node), text, !exact),
    );
    // Innermost: an element whose matching text all comes from a matching child is the child's.
    return candidates.filter(
      (node) => !candidates.some((other) => other !== node && contains(node, other)),
    );
  }

  private _controls(): _Element[] {
    return _descendants(this._node).filter((node) => CONTROLS.has(node.tag));
  }

  /** The controls `field` names: by name, then id, then label. Throws when nothing does. */
  private _field(field: string): _Element[] {
    const controls = this._controls();
    const byName = controls.filter((node) => _attr(node, "name") === field);
    if (byName.length > 0) return byName;
    const byId = controls.filter((node) => _attr(node, "id") === field);
    if (byId.length > 0) return byId;
    const byLabel = controls.filter(
      (node) => !isHiddenInput(node) && matchText(_nameOf(node), field),
    );
    if (byLabel.length > 0) return byLabel;
    this._fail(
      `Expected a field named or labelled "${field}", but none is here.`,
      controls.length > 0 ? "Fields here:" : null,
      this._fieldList(),
    );
  }

  private _checkable(field: string, value: FieldValue | undefined): _Element {
    const group = this._field(field);
    if (value === undefined) return group[0]!;
    const found = group.find((node) => fieldValue(node) === String(value));
    if (!found) {
      this._fail(
        `Expected the field "${field}" to have an option "${value}", but it has ` +
          `${group.map((node) => `"${fieldValue(node)}"`).join(", ")}.`,
      );
    }
    return found!;
  }

  private _fieldList(): string[] {
    return this._controls().map((node) => {
      const name = _attr(node, "name");
      const label = isHiddenInput(node) ? "" : _nameOf(node);
      const type = node.tag === "input" ? (_attr(node, "type") ?? "text") : node.tag;
      return [
        type,
        name !== null ? `name="${name}"` : null,
        label ? `labelled "${label}"` : null,
        `value "${truncate(fieldValue(node), 40)}"`,
      ]
        .filter(Boolean)
        .join(" ");
    });
  }

  private _roles(): string[] {
    const counts = new Map<string, number>();
    for (const node of _descendants(this._node)) {
      const role = _roleOf(node);
      if (role && !_isHiddenFromA11y(node)) counts.set(role, (counts.get(role) ?? 0) + 1);
    }
    return [...counts].map(([role, count]) => (count > 1 ? `${role} ×${count}` : role));
  }
}

/**
 * A parsed page: what {@link TestResponse.html} returns, and {@link parseHtml} makes from any
 * HTML — the markup a `FlowTest` rendered, say.
 *
 * @example
 * const page = (await app.get("/projects")).assertOk().html();
 * page.assertTitle("Projects — Acme");
 * page.getByRole("link", { name: "New project" });
 * expect(page.getByRole("list", { name: "Projects" }).findAllByRole("listitem")).toHaveLength(2);
 */
export class HtmlDocument extends HtmlScope {
  /** @internal Use {@link parseHtml}, or `TestResponse.html()`. */
  constructor(source: string, note?: string) {
    super(_parseHtml(source), note);
  }

  /** The `<title>`, whitespace collapsed. `""` when the page has none. */
  title(): string {
    const title = _descendants(this._node).find((node) => node.tag === "title");
    return title
      ? _collapse(title.children.map((n) => (n.type === "text" ? n.text : "")).join(""))
      : "";
  }

  /**
   * Assert the page's `<title>`. A string must match it exactly, a pattern need only match.
   *
   * @example
   * page.assertTitle(/^Sign in/);
   */
  assertTitle(title: TextMatch): this {
    const actual = this.title();
    if (!matchText(actual, title)) {
      this._fail(
        actual
          ? `Expected the page's title to be ${show(title)}, but it is "${actual}".`
          : `Expected the page's title to be ${show(title)}, but the page has no <title>.`,
      );
    }
    return this;
  }

  html(): string {
    return _innerHtml(this._node);
  }

  /** @internal */
  protected _describe(): string {
    const title = this.title();
    return title ? `On the page "${title}"` : "On the page";
  }
}

/**
 * One element of a parsed page. Every query and assertion a page has works inside it, so a
 * test can narrow to one form or one list first.
 *
 * @example
 * const form = page.form("/settings/two-factor/confirm");
 * expect(form.submitButton()?.text()).toBe("Turn on");
 */
export class HtmlElement extends HtmlScope {
  /** @internal */
  static _of(node: _Element, note?: string): HtmlElement {
    return new HtmlElement(node, note);
  }

  /** The tag name, lower-cased: `"a"`, `"input"`. */
  get tag(): string {
    return this._node.tag;
  }

  /** An attribute's value, its character references decoded. `null` when it is not set. */
  attr(name: string): string | null {
    return _attr(this._node, name.toLowerCase());
  }

  /** Every attribute, by name. */
  attributes(): Record<string, string> {
    return Object.fromEntries(this._node.attrs);
  }

  /** The role: its `role` attribute, or the one its tag implies. `null` for none. */
  role(): string | null {
    return _roleOf(this._node);
  }

  /** The accessible name: what a screen reader announces it as. `""` when it has none. */
  name(): string {
    return _nameOf(this._node);
  }

  /**
   * A form control's value as the page was sent: an input's `value`, a textarea's text, a
   * select's chosen option (each chosen one, comma-separated, for a `multiple` select).
   */
  value(): string {
    return fieldValue(this._node);
  }

  /** Whether a checkbox or radio is checked, or an `<option>` selected. */
  isChecked(): boolean {
    return _matches(this._node, ":checked");
  }

  /** Whether a form control is disabled, by itself or by a disabled `<fieldset>` around it. */
  isDisabled(): boolean {
    return _matches(this._node, ":disabled");
  }

  /** The element this one sits in, or `null` at the top. */
  parent(): HtmlElement | null {
    const parent = this._node.parent;
    return parent && parent.tag !== "#document" ? this._wrap(parent) : null;
  }

  /** The child elements, in order. */
  children(): HtmlElement[] {
    return _childElements(this._node).map((node) => this._wrap(node));
  }

  /**
   * For a `<form>`: the button a browser presses when Enter is hit in one of its fields — the
   * first submit button that belongs to it, counting a button elsewhere that names the form
   * in its `form` attribute and skipping one inside that names another. `null` when it has none.
   */
  submitButton(): HtmlElement | null {
    if (this._node.tag !== "form") {
      throw new Error(`submitButton() reads a <form>, and this is ${describeElement(this._node)}.`);
    }
    const id = _attr(this._node, "id");
    const found = _descendants(_rootOf(this._node)).find((node) => {
      if (!isSubmit(node)) return false;
      const owner = _attr(node, "form");
      if (owner !== null) return id !== null && owner === id;
      return contains(this._node, node);
    });
    return found ? this._wrap(found) : null;
  }

  html(): string {
    return _outerHtml(this._node);
  }

  /** The start tag, for reading in a failure: `<a href="/projects">`. */
  toString(): string {
    return describeElement(this._node);
  }

  /** @internal */
  protected _describe(): string {
    return `Inside ${describeElement(this._node)}`;
  }
}

/**
 * Parse HTML for the assertions a page has. Takes markup, or anything with an `html()` method:
 * a `TestResponse`, or the `FlowTest` that rendered a page.
 *
 * @example
 * const t = await FlowTest.mount(LoginPage);
 * parseHtml(t).getByLabel("Email");
 */
export function parseHtml(source: string | { html(): string | HtmlDocument }): HtmlDocument {
  if (typeof source === "string") return new HtmlDocument(source);
  const html = source.html();
  return typeof html === "string" ? new HtmlDocument(html) : html;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function matchText(actual: string, expected: TextMatch, loose = false, within = false): boolean {
  if (expected instanceof RegExp) {
    expected.lastIndex = 0;
    return expected.test(actual);
  }
  const wanted = _collapse(expected);
  if (within) return actual.includes(wanted);
  return loose ? actual.toLowerCase().includes(wanted.toLowerCase()) : actual === wanted;
}

function show(value: TextMatch): string {
  return typeof value === "string" ? `"${value}"` : String(value);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function contains(ancestor: _Element, node: _Element): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

function isHiddenInput(node: _Element): boolean {
  return node.tag === "input" && (_attr(node, "type") ?? "").toLowerCase() === "hidden";
}

function isSubmit(node: _Element): boolean {
  if (node.tag === "button") {
    const type = (_attr(node, "type") ?? "submit").toLowerCase();
    return type !== "button" && type !== "reset";
  }
  if (node.tag === "input") {
    const type = (_attr(node, "type") ?? "").toLowerCase();
    return type === "submit" || type === "image";
  }
  return false;
}

function fieldValue(node: _Element): string {
  if (node.tag === "textarea") {
    const text = node.children.map((child) => (child.type === "text" ? child.text : "")).join("");
    return text.startsWith("\n") ? text.slice(1) : text;
  }
  if (node.tag === "select") {
    const options = _descendants(node).filter((child) => child.tag === "option");
    const selected = options.filter((option) => _attr(option, "selected") !== null);
    if (_attr(node, "multiple") !== null) return selected.map(optionValue).join(",");
    const chosen = selected.at(-1) ?? options.find((option) => _attr(option, "disabled") === null);
    return chosen ? optionValue(chosen) : "";
  }
  if (node.tag === "option") return optionValue(node);
  const value = _attr(node, "value");
  if (value !== null) return value;
  const type = (_attr(node, "type") ?? "").toLowerCase();
  return type === "checkbox" || type === "radio" ? "on" : "";
}

function optionValue(option: _Element): string {
  return _attr(option, "value") ?? _visibleText(option);
}

function fieldErrors(control: _Element): { invalid: boolean; messages: string[] } {
  // An empty value is the default, false, as in ARIA.
  const flag = _attr(control, "aria-invalid") ?? "false";
  const invalid = flag !== "" && flag !== "false";
  const ids = [
    ...(_attr(control, "aria-errormessage") ?? "").split(/\s+/),
    ...(invalid ? (_attr(control, "aria-describedby") ?? "").split(/\s+/) : []),
  ].filter(Boolean);
  const messages = [...new Set(ids)]
    .map((id) => _byId(control, id))
    .filter((node): node is _Element => node !== null && _isVisible(node))
    .map((node) => _visibleText(node))
    .filter(Boolean);
  return { invalid, messages };
}

function formAction(form: _Element): string {
  return _attr(form, "action") ?? "";
}

function formMethod(form: _Element): string {
  return (_attr(form, "method") || "get").toUpperCase();
}

/** A path matches itself, and an absolute URL with that path, query and hash. */
function urlMatches(actual: string, expected: string | RegExp): boolean {
  if (expected instanceof RegExp) {
    expected.lastIndex = 0;
    return expected.test(actual);
  }
  if (actual === expected) return true;
  if (!expected.startsWith("/") || !/^[a-z][a-z0-9+.-]*:/i.test(actual)) return false;
  try {
    const url = new URL(actual);
    return `${url.pathname}${url.search}${url.hash}` === expected;
  } catch {
    return false;
  }
}

/** The start tag without `class` and `style` (long, and never what a test is about), and its text. */
function describeElement(node: _Element): string {
  const brief: _Element = {
    ...node,
    attrs: node.attrs.filter(([name]) => name !== "class" && name !== "style"),
  };
  const tag = truncate(_startTag(brief), 160);
  const text = _visibleText(node);
  if (CONTROLS.has(node.tag) || !text) return tag;
  return `${tag}${truncate(text, 60)}</${node.tag}>`;
}

function describeNamed(node: _Element): string {
  const name = _nameOf(node);
  const level = _levelOf(node);
  return `${_roleOf(node)}${level !== null ? ` (level ${level})` : ""} ${name ? `"${name}"` : "with no name"}`;
}

function describeLink(node: _Element): string {
  const name = _nameOf(node);
  return `${name ? `"${name}"` : "(no name)"} → ${_attr(node, "href")}`;
}

function describeForm(node: _Element): string {
  const action = formAction(node);
  const button = _descendants(node).find(isSubmit);
  const label = button ? ` (${_nameOf(button) || "unnamed button"})` : "";
  return `${formMethod(node)} ${action === "" ? "(this page)" : action}${label}`;
}

function describeRole(role: string, options: ByRoleOptions): string {
  const level = options.level !== undefined ? ` of level ${options.level}` : "";
  const name = options.name !== undefined ? ` named ${show(options.name)}` : "";
  return `an element with the role "${role}"${level}${name}`;
}

function describeCheckable(field: string, value: FieldValue | undefined): string {
  return value === undefined ? `the field "${field}"` : `the "${value}" option of "${field}"`;
}
