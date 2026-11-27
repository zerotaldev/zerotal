/**
 * The `make:flow` command — scaffolds a Flow page or child component.
 *
 * This is the Flow counterpart to `make:controller` / `make:page`: the
 * flagship server-driven layer previously had no generator, so every
 * `Component` was hand-written. `make:flow Name` emits a ready-to-run class
 * with an `@expose`/`render` skeleton; `--child`, `--crud`, and `--layout`
 * cover the common shapes.
 */
import { Command, pluralize } from "@zerotal/core";
import {
  _frameworkImport,
  _readModel,
  _writeAppSource,
  type _ModelColumn,
  type _ModelShape,
} from "@zerotal/core/commands";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** Where pages live, in preference order. Real apps use `app/flow/pages`. */
const PAGE_DIRS = ["app/flow/pages", "app/flow"];
/** Where child components live, in preference order. */
const CHILD_DIRS = ["app/flow/components", "app/flow/components"];

export class MakeFlowCommand extends Command {
  static override commandName = "make:flow";
  static override description = "Create a new Flow page or child component";
  static override needsApp = false;

  static override args = [
    {
      name: "name",
      required: true,
      description: "Class name, optionally nested (e.g. Dashboard or Users/Index)",
    },
  ];

  static override flags = [
    {
      name: "child",
      type: "boolean" as const,
      description: "Scaffold a child component (props come from its parent) instead of a page",
      default: false,
    },
    {
      name: "crud",
      type: "boolean" as const,
      description: "Scaffold a resourceful page with list/create/edit/delete actions",
      default: false,
    },
    {
      name: "layout",
      type: "string" as const,
      description: "Wrap the page in a layout, e.g. --layout AppLayout",
      default: "",
    },
    {
      name: "model",
      type: "string" as const,
      description: "With --crud, list, create, edit and delete this model, e.g. --model Post",
      default: "",
    },
    {
      name: "dir",
      type: "string" as const,
      description: "Override the target directory (default: app/flow/pages or app/flow/components)",
      default: "",
    },
  ];

  override async run(): Promise<void> {
    const name = this.args["name"]!; // e.g. "Users/Index"
    const child = this.flags["child"] as boolean;
    const crud = this.flags["crud"] as boolean;
    const layout = ((this.flags["layout"] as string | undefined) ?? "").trim();
    const model = ((this.flags["model"] as string | undefined) ?? "").trim();
    const dirFlag = ((this.flags["dir"] as string | undefined) ?? "").trim();

    const componentName = name.includes("/") ? name.split("/").pop()! : name;
    const baseDir = dirFlag
      ? dirFlag.replace(/\\/g, "/").replace(/\/+$/, "")
      : _pickDir(child ? CHILD_DIRS : PAGE_DIRS);
    // A page's file name is its URL, because file-based routing serves `pages/posts.tsx` at
    // `/posts`, and the router is case-sensitive: `Posts.tsx` was served at `/Posts` while this
    // command printed `/posts`, and the page 404'd at the address it was given. Pages are written
    // in the starters' style (lowercase, kebab-case); a child component is not routed and keeps
    // its class name.
    const path = child ? `${baseDir}/${name}.tsx` : `${baseDir}/${_pageFile(name)}.tsx`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    // The layout is looked for where it actually is, not where its name suggests: the starters
    // keep `AppLayout` in `layouts/app.tsx`, and an import of `layouts/AppLayout.tsx` failed to
    // compile and, at boot, left the route a silent 404 behind one "Failed to import" log line.
    const layoutsDir = join(dirname(baseDir), "layouts");
    const layoutFile = layout && !child ? _findExport(layoutsDir, layout) : undefined;
    const layoutImport = layout ? _importPath(path, layoutFile ?? join(layoutsDir, layout)) : "";

    const modelFile = model && crud && !child ? _findExport("app/models", model) : undefined;
    const modelImport = model ? _importPath(path, modelFile ?? join("app/models", model)) : "";

    // The starters give every page a base class, `Page` in app/flow/lib/page.ts, which reads the
    // signed-in user, the flash messages and the field errors, and hands the layout what it
    // needs. A page generated beside them extends it too, rather than the bare `Component`.
    const pageFile = child ? undefined : _findExport(join(dirname(baseDir), "lib"), "Page");
    const base: _PageBase | undefined = pageFile
      ? {
          import: _importPath(path, pageFile),
          titled: /export\s+function\s+titled\b/.test(readFileSync(`${pageFile}.ts`, "utf8")),
        }
      : undefined;
    // On a starter page, the layout is the signed-in shell unless another is asked for.
    const pageLayout = layout || (base && _findExport(layoutsDir, "AppLayout") ? "AppLayout" : "");
    const pageLayoutFile = pageLayout ? _findExport(layoutsDir, pageLayout) : undefined;
    const pageLayoutImport = pageLayout
      ? _importPath(path, pageLayoutFile ?? join(layoutsDir, pageLayout))
      : "";
    // A layout that takes the page's shell (`<AppLayout shell={this.shell()}>`) is rendered from
    // `layout()`; any other is the `static layout` a plain component names.
    const shellLayout =
      base !== undefined &&
      pageLayoutFile !== undefined &&
      /\bshell\b/.test(readFileSync(`${pageLayoutFile}.tsx`, "utf8"));

    // Every kind of page sits in the app the same way: on its base class, in its layout.
    const frame: _PageFrame = {
      name: componentName,
      base,
      layout: pageLayout,
      layoutImport: pageLayoutImport,
      shellLayout,
    };

    let stub: string;
    let shape: _ModelShape | undefined;
    if (child) {
      if (crud || layout || model) {
        this.warn("--crud, --layout and --model are ignored for a child component.");
      }
      stub = _childStub(componentName);
    } else if (crud) {
      shape = model ? _readModel(model) : undefined;
      stub = model
        ? _modelCrudStub({
            ...frame,
            url: _urlFor(name),
            model,
            modelImport,
            shape,
            auth: _frameworkImport("@zerotal/auth"),
            styles: _appStyles(baseDir, path),
          })
        : _crudStub(frame);
    } else {
      if (model) this.warn("--model is used with --crud; it is ignored for a plain page.");
      stub = _pageStub(frame);
    }

    // The starters set `jsxImportSource` in tsconfig.json, and none of their pages carries the
    // pragma; a page generated beside them carries it only where no tsconfig says it.
    if (!_tsconfigSetsFlowJsx(dirname(path))) stub = `${FLOW_JSX_PRAGMA}\n${stub}`;

    await _writeAppSource(path, stub);
    this.info(`Created: ${path}`);

    if (layout && !child && !layoutFile) {
      this.warn(
        `  No layout exports ${layout} in ${layoutsDir}/. The page imports it from ` +
          `${layoutImport}; create it there, or change the import.`,
      );
    }
    if (model && crud && !child && !modelFile) {
      this.warn(
        `  No model exports ${model} in app/models/. The page imports it from ${modelImport}; ` +
          `run \`bun zt make:model ${model} --migration\`, or change the import.`,
      );
    }

    if (!child) {
      const url = _urlFor(name);
      if (_servedByFileRouting(baseDir)) {
        this.dim(`  File-based routing serves it at ${url}.`);
      } else {
        // The starters register every page in routes/web.ts, and serve nothing from
        // app/flow/pages by itself: this used to say "File-based routing serves this
        // automatically", and the page was a 404 at the address it named.
        const routes = existsSync("routes/web.ts") ? "routes/web.ts" : "your routes file";
        const from = existsSync("routes/web.ts")
          ? _importPath("routes/web.ts", path.replace(/\.tsx$/, ""))
          : path.replace(/\.tsx$/, "");
        const routeName = url.slice(1).replace(/\//g, ".") || "home";
        this.warn(`  Nothing serves ${url} yet. Add the page to ${routes}:`);
        this.dim(`    import { ${componentName} } from "${from}";`);
        this.dim(`    Router.flow("${url}", ${componentName}).name("${routeName}");`);
        if (shape?.owner) {
          this.dim(
            `  It lists the signed-in user's records, so put it inside the signed-in group ` +
              `(beside /projects in the starters).`,
          );
        }
      }
    }
  }
}

/**
 * Whether the app serves the pages in `dir` by file-based routing: its bootstrap points
 * `fileBasedRouting()` at that directory. The starters do not; they register pages in
 * routes/web.ts and point file-based routing at app/routes/, the form handlers.
 *
 * @internal Exported for tests.
 */
export function _servedByFileRouting(dir: string): boolean {
  let source: string;
  try {
    source = readFileSync("bootstrap/app.ts", "utf8");
  } catch {
    return false;
  }
  // Up to the first `)`, which is the end of a `basePath("…")` argument or of the call itself.
  const calls = source.match(/fileBasedRouting\s*\([^)]*\)/g) ?? [];
  return calls.some((call) => call.includes(dir));
}

/** The pragma a page needs when no tsconfig names Flow's JSX runtime. */
const FLOW_JSX_PRAGMA = "/** @jsxImportSource @zerotal/flow */";

/**
 * Whether the nearest `tsconfig.json` at or above `dir` sets `jsxImportSource` to
 * `@zerotal/flow`, so a page under it needs no pragma.
 *
 * @internal Exported for tests.
 */
export function _tsconfigSetsFlowJsx(dir: string): boolean {
  let current = resolve(dir);
  for (;;) {
    const file = join(current, "tsconfig.json");
    if (existsSync(file)) {
      try {
        return /"jsxImportSource"\s*:\s*"@zerotal\/flow"/.test(readFileSync(file, "utf8"));
      } catch {
        return false;
      }
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/** First existing candidate directory, else the first candidate as the default. */
function _pickDir(candidates: string[]): string {
  return candidates.find((d) => existsSync(d)) ?? candidates[0]!;
}

/** Derive a kebab-case URL path from a (possibly nested) class name. */
function _urlFor(name: string): string {
  // As the file router reads the file `_pageFile()` names: an `index` segment is the directory.
  const segments = _pageFile(name)
    .split("/")
    .filter((segment) => segment !== "index");
  const path = segments.filter(Boolean).join("/");
  return "/" + path;
}

/** `Users/Index` → `users/index`, `BlogPostPage` → `blog-post`: the page's path under pages/. */
function _pageFile(name: string): string {
  return name
    .split("/")
    .map((seg) =>
      seg
        .replace(/Page$/, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .toLowerCase(),
    )
    .join("/");
}

/**
 * The file in `dir` that exports `name` as a class, function or constant, without its extension.
 * The name of a file says nothing reliable about what it exports, so its contents are read.
 */
function _findExport(dir: string, name: string): string | undefined {
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file));
  } catch {
    return undefined;
  }
  const declares = new RegExp(
    `export\\s+(?:default\\s+)?(?:abstract\\s+)?(?:class|function|const)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`,
  );
  const exact = files.find((file) => file.replace(/\.tsx?$/, "") === name);
  const ordered = exact ? [exact, ...files.filter((file) => file !== exact)] : files;
  for (const file of ordered) {
    if (declares.test(readFileSync(join(dir, file), "utf8"))) {
      return join(dir, file.replace(/\.tsx?$/, ""));
    }
  }
  return undefined;
}

/** A relative import from the page at `from` to the module at `to` (no extension). */
function _importPath(from: string, to: string): string {
  const path = relative(dirname(from), to).replace(/\\/g, "/");
  return path.startsWith(".") ? path : `./${path}`;
}

/**
 * How a generated page sits in the app: the base class it extends and the layout it renders in.
 *
 * In an app with the starters' `Page` base, every page extends it, names its tab with `titled()`,
 * and renders its layout from `layout()` with the page's shell, as the starter's own pages do.
 * Elsewhere it extends `Component` and names its layout as `static layout`. (Only `--crud
 * --model` used to do the former: a plain or `--crud` page extended `Component`, and `--layout`
 * wrote a `static layout` the starter's layouts do not take.)
 */
interface _PageFrame {
  /** The page's class name. */
  name: string;
  base: _PageBase | undefined;
  /** The layout, or empty for none. */
  layout: string;
  /** Its import, relative to the page. */
  layoutImport: string;
  /** The layout takes the page's shell, and is rendered from `layout()`. */
  shellLayout: boolean;
}

/** The parts of a page that its frame decides. */
interface _FrameParts {
  /** What the page imports from `@zerotal/flow` for its frame. */
  flow: string[];
  /** The layout's import line, if any. */
  layoutImport: string[];
  /** The base class's import line, if any. */
  baseImport: string[];
  /** The class it extends. */
  extends: string;
  /** Static members, one per line, indented. */
  statics: string[];
  /** The `layout()` method, indented, with a blank line before it; empty when there is none. */
  layoutMethod: string;
}

/**
 * What a page's frame adds to it. Every generated page has actions, so on the starters' `Page`,
 * which renders plain HTML by default, it turns live state back on.
 */
function _frameParts(f: _PageFrame): _FrameParts {
  const onPage = f.base !== undefined;
  return {
    flow: [...(onPage ? [] : ["Component"]), ...(f.shellLayout ? ["type HtmlNode"] : [])],
    layoutImport: f.layout ? [`import { ${f.layout} } from "${f.layoutImport}";`] : [],
    baseImport: onPage
      ? [`import { Page${f.base!.titled ? ", titled" : ""} } from "${f.base!.import}";`]
      : [],
    extends: onPage ? "Page" : "Component",
    statics: [
      ...(onPage ? ["  static override interactive = true;"] : []),
      ...(onPage && f.base!.titled
        ? [`  static override title = titled("${_label(f.name.replace(/Page$/, ""))}");`]
        : []),
      ...(f.layout && !f.shellLayout ? [`  static layout = ${f.layout};`] : []),
    ],
    layoutMethod: f.shellLayout
      ? `
  override layout(page: HtmlNode): HtmlNode {
    return <${f.layout} shell={this.shell()}>{page}</${f.layout}>;
  }
`
      : "",
  };
}

/** The page's `@zerotal/flow` import: `Component` (when it extends it), `names`, then types. */
function _flowImport(parts: _FrameParts, names: string[]): string {
  const base = parts.flow.filter((n) => n === "Component");
  const types = parts.flow.filter((n) => n !== "Component");
  return `import { ${[...base, ...names, ...types].join(", ")} } from "@zerotal/flow";`;
}

/** A page's imports: `@zerotal/flow` with `names`, then its layout and its base class. */
function _frameImports(parts: _FrameParts, names: string[]): string {
  return [_flowImport(parts, names), ...parts.layoutImport, ...parts.baseImport].join("\n");
}

/** The class's opening statics, followed by a blank line, or nothing. */
function _staticsBlock(parts: _FrameParts): string {
  return parts.statics.length ? `${parts.statics.join("\n")}\n\n` : "";
}

/** A minimal page: one exposed field, one action, a render. */
function _pageStub(f: _PageFrame): string {
  const parts = _frameParts(f);
  return `${_frameImports(parts, ["expose"])}

export class ${f.name} extends ${parts.extends} {
${_staticsBlock(parts)}  @expose count = 0;
${parts.layoutMethod}
  @expose increment(): void {
    this.count++;
  }

  override async render() {
    return (
      <div>
        <h1>${f.name}</h1>
        <p>Count: {this.count}</p>
        <button onClick={this.increment}>+</button>
      </div>
    );
  }
}
`;
}

/** A child component: props assigned by the parent, its own isolated state. */
function _childStub(name: string): string {
  return `import { Component, expose, locked } from "@zerotal/flow";

export class ${name} extends Component {
  // A prop from the parent lands on the same-named field before any hook runs.
  // Mark it @locked so the value survives WebSocket round-trips.
  @locked label = "Count";

  @expose count = 0;

  @expose increment(): void {
    this.count++;
  }

  override async render() {
    return (
      <div class="rounded-lg border p-4">
        <p class="text-sm text-gray-500">{this.label}</p>
        <p class="text-2xl font-bold">{this.count}</p>
        <button onClick={this.increment}>+</button>
      </div>
    );
  }
}
`;
}

/** A resourceful page: list + create/edit/delete, validation, and a form. */
function _crudStub(f: _PageFrame): string {
  const parts = _frameParts(f);
  const name = f.name;
  return `${_frameImports(parts, ["expose", "locked", "validate"])}

// TODO: swap this shape for your model type.
interface Item {
  id: number;
  name: string;
}

export class ${name} extends ${parts.extends} {
${_staticsBlock(parts)}  @locked items: Item[] = [];
  @expose editingId: number | null = null;
  @expose @validate((rule) => rule.required().min(2)) name = "";
${parts.layoutMethod}
  override async onMount(): Promise<void> {
    await this.load();
  }

  @expose async load(): Promise<void> {
    // TODO: load from your model, e.g. this.items = await Item.query().get();
    this.items = [];
  }

  @expose async save(): Promise<void> {
    await this.validate();

    if (this.editingId === null) {
      // TODO: create — await Item.create({ name: this.name });
    } else {
      // TODO: update — await Item.where("id", this.editingId).update({ name: this.name });
    }

    this.reset();
    this.refresh(); // re-run onMount() → reload the list
    this.flash("Saved.");
  }

  @expose edit(id: number): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    this.editingId = id;
    this.name = item.name;
  }

  @expose async destroy(id: number): Promise<void> {
    // TODO: delete — await Item.where("id", id).delete();
    this.refresh();
    this.flash("Deleted.");
  }

  @expose reset(): void {
    this.editingId = null;
    this.name = "";
    this.resetValidation();
  }

  override async render() {
    return (
      <div class="max-w-xl mx-auto space-y-6 p-6">
        <h1 class="text-2xl font-bold">${name}</h1>

        <form onSubmit={this.save} class="flex items-start gap-2">
          <div class="flex-1">
            <input value={this.name} class="input w-full" placeholder="Name" />
            <span error={this.errors.name} class="text-sm text-red-500" />
          </div>
          <button type="submit" loadingAttr="disabled">
            {this.editingId === null ? "Add" : "Update"}
          </button>
          {this.editingId !== null && (
            <button type="button" onClick={this.reset}>
              Cancel
            </button>
          )}
        </form>

        <ul class="divide-y">
          {this.items.map((item) => (
            <li key={String(item.id)} class="flex items-center justify-between py-2">
              <span>{item.name}</span>
              <span class="flex gap-3">
                <button onClick={() => this.edit(item.id)}>Edit</button>
                <button onClick={() => this.destroy(item.id)} confirm="Delete this?" class="text-red-600">
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
}
`;
}

/** The app's own page base class, when it has one (the starters' `Page`). */
interface _PageBase {
  /** Its import, relative to the page. */
  import: string;
  /** Its module also exports `titled()`, which the starters' pages name their tab with. */
  titled: boolean;
}

/** Members of `Component` and the starters' `Page` that a form field must not shadow. */
const RESERVED = new Set([
  "id",
  "items",
  "editingId",
  "errors",
  "error",
  "user",
  "http",
  "path",
  "flashes",
  "shell",
  "old",
  "layout",
  "render",
  "refresh",
  "flash",
  "validate",
  "reset",
  "save",
  "edit",
  "destroy",
  "load",
  "owned",
  "signal",
  "cancelled",
  "html",
  "slot",
]);

/** What the model CRUD stub is built from. */
interface _ModelCrudStubOptions extends _PageFrame {
  url: string;
  model: string;
  modelImport: string;
  /** The model's columns, read from its source; absent when the model was not found. */
  shape: _ModelShape | undefined;
  /** The specifier `Auth` is imported by, for owner scoping on a page without the starter base. */
  auth: string;
  /** The app's own class lists, when it has the starters' `lib/ui.ts` and `lib/button.ts`. */
  styles: _AppStyles | undefined;
}

/**
 * Where the starters keep their class lists: `INPUT` and the rest in `lib/ui.ts`, and
 * `buttonClass()` in `lib/button.ts`. A page generated beside them uses those, so its form looks
 * like the rest of the app. (It wrote `class="input w-full"`, and no stylesheet defines `input`:
 * the fields rendered with no border.)
 *
 * @internal
 */
export interface _AppStyles {
  /** Import specifier for `lib/ui.ts`, relative to the page. */
  ui: string;
  /** Import specifier for `lib/button.ts`, relative to the page. */
  button: string;
  /** The `lib/ui.ts` constants this page uses that the app exports. */
  names: Set<string>;
}

/** The class lists a generated page reads from the starters' `lib/ui.ts`. */
const UI_NAMES = ["INPUT", "FIELD_ERROR", "CHECKBOX", "PAGE_TITLE"] as const;

/** The app's class lists, read from the `lib/` beside the pages directory, if it has them. */
function _appStyles(pagesDir: string, page: string): _AppStyles | undefined {
  const lib = join(dirname(pagesDir), "lib");
  const ui = join(lib, "ui.ts");
  const button = join(lib, "button.ts");
  if (!existsSync(ui) || !existsSync(button)) return undefined;
  const uiSource = readFileSync(ui, "utf8");
  if (!/export\s+function\s+buttonClass\b/.test(readFileSync(button, "utf8"))) return undefined;
  const names = new Set(
    UI_NAMES.filter((name) => new RegExp(`export\\s+const\\s+${name}\\b`).test(uiSource)),
  );
  if (!names.has("INPUT")) return undefined;
  return {
    ui: _importPath(page, join(lib, "ui")),
    button: _importPath(page, join(lib, "button")),
    names,
  };
}

/** A class attribute: the app's constant when it has one, else plain Tailwind. */
function _cls(
  styles: _AppStyles | undefined,
  name: (typeof UI_NAMES)[number],
  fallback: string,
): string {
  return styles?.names.has(name) ? `class={${name}}` : `class="${fallback}"`;
}

/** A button's class attribute, in the app's style when it has `buttonClass()`. */
function _btn(styles: _AppStyles | undefined, variant: "primary" | "secondary" | "danger"): string {
  if (styles)
    return variant === "primary" ? "class={buttonClass()}" : `class={buttonClass("${variant}")}`;
  if (variant === "primary")
    return 'class="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"';
  if (variant === "danger") return 'class="text-sm font-medium text-red-600 hover:underline"';
  return 'class="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50"';
}

const PLAIN_INPUT = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
const PLAIN_ERROR = "text-sm text-red-600";

/** A column the form edits as a date: a `Date` property, from a `date` or `datetime` column. */
function _isDate(column: _ModelColumn): boolean {
  return column.type === "Date";
}

/** The form's initial value for a column of this type. */
function _initial(column: _ModelColumn): string {
  if (column.type === "number") return "0";
  if (column.type === "boolean") return "false";
  return '""';
}

/** The form control for one field, bound to the page's field of the same name. */
function _control(column: _ModelColumn, label: string, styles: _AppStyles | undefined): string {
  const p = column.property;
  if (column.type === "boolean") {
    return `<label class="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={this.${p}} ${_cls(styles, "CHECKBOX", "size-4")} />
              ${label}
            </label>`;
  }
  const type = column.type === "number" ? ` type="number"` : _isDate(column) ? ` type="date"` : "";
  return `<input${type} value={this.${p}} ${_cls(styles, "INPUT", PLAIN_INPUT)} placeholder="${label}" aria-label="${label}" />
            <span error={this.errors.${p}} ${_cls(styles, "FIELD_ERROR", PLAIN_ERROR)} />`;
}

/** `dueOn` → `Due on`: a label from a property name. */
function _label(property: string): string {
  const words = property.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A resourceful page over a real model: list, create, edit and delete, with nothing left to fill
 * in.
 *
 * Its fields are the model's own: the mass-assignable columns that are strings, numbers or
 * booleans, read from the model's source. (It assumed a `name` column, and a model without one
 * failed to typecheck in four places.) A model with an owner column (`userId`) is scoped to the
 * signed-in user: the list, and every edit and delete, read only that user's records, and a new
 * one is theirs. In an app with the starters' `Page` base, the page extends it.
 */
function _modelCrudStub(o: _ModelCrudStubOptions): string {
  const { name, model } = o;
  const record = model.charAt(0).toLowerCase() + model.slice(1);
  const records = pluralize(record);
  // Without the model's source to read, assume what `make:model` starts a model with.
  const assumed: _ModelColumn = {
    property: "name",
    column: "name",
    type: "string",
    nullable: false,
  };
  const editable = (
    o.shape
      ? o.shape.fillable
          .map((property) => o.shape!.columns.find((c) => c.property === property))
          .filter((c): c is _ModelColumn => c !== undefined)
      : [assumed]
  ).filter(
    (c) =>
      c !== o.shape?.owner &&
      !RESERVED.has(c.property) &&
      (["string", "number", "boolean"].includes(c.type) || _isDate(c)),
  );
  const fields = editable.length > 0 ? editable : [];
  const first = fields.find((c) => c.type === "string");
  const owner = o.shape?.owner;
  const onPage = o.base !== undefined;
  const userId = onPage ? "this.user?.id ?? 0" : "Auth.user().id";

  const parts = _frameParts(o);
  const imports = [
    _flowImport(parts, ["expose", "locked", ...(first ? ["validate"] : [])]),
    ...(owner && !onPage ? [`import { Auth } from "${o.auth}";`] : []),
    `import { ${model} } from "${o.modelImport}";`,
    ...parts.layoutImport,
    ...(o.styles ? [`import { buttonClass } from "${o.styles.button}";`] : []),
    ...parts.baseImport,
    ...(o.styles
      ? [`import { ${[...o.styles.names].sort().join(", ")} } from "${o.styles.ui}";`]
      : []),
  ].join("\n");

  const rowKeys = ["id", ...fields.map((c) => c.property)];
  const fieldLines = fields.map((c) => {
    const rule = c === first ? "@validate((rule) => rule.required()) " : "";
    return `  @expose ${rule}${c.property} = ${_initial(c)};`;
  });
  const assignFrom = (source: string) =>
    fields
      .map(
        (c) =>
          `    this.${c.property} = ${source}.${c.property}${_isDate(c) ? "" : c.nullable && c.type === "string" ? ' ?? ""' : c.nullable ? ` ?? ${_initial(c)}` : ""};`,
      )
      .join("\n");
  // A date field holds the form's `YYYY-MM-DD`; the model wants a `Date`, or null when blank.
  const toModel = (c: _ModelColumn) =>
    _isDate(c)
      ? c.nullable
        ? `${c.property}: this.${c.property} ? new Date(this.${c.property}) : null`
        : `${c.property}: new Date(this.${c.property})`
      : `${c.property}: this.${c.property}`;
  // A row holds a date as the form's `YYYY-MM-DD` string: the page's state goes to the browser
  // and back as JSON, and a `Date` would come back as a string anyway.
  const fromModel = (c: string) => {
    const column = fields.find((f) => f.property === c);
    if (!column || !_isDate(column)) return `${record}.${c}`;
    return `${record}.${c} ? ${record}.${c}.toISOString().slice(0, 10) : ""`;
  };
  const dates = fields.filter(_isDate);
  const clear = fields.map((c) => `    this.${c.property} = ${_initial(c)};`).join("\n");
  const data = fields.length ? `{ ${fields.map(toModel).join(", ")} }` : "{}";
  const owned = owner ? `${model}.query().where("${owner.column}", ${userId})` : `${model}.query()`;
  const shown = first ? `{item.${first.property}}` : `{\`#\${item.id}\`}`;
  const controls = fields
    .map(
      (c) =>
        `          <div class="flex-1">\n            ${_control(c, _label(c.property), o.styles)}\n          </div>`,
    )
    .join("\n");

  const source = `${imports}

/** A ${record} as the page holds it: the columns it lists and edits${dates.length ? ", with dates as `YYYY-MM-DD`" : ""}. */
type Row = ${
    dates.length
      ? `Pick<${model}, ${rowKeys
          .filter((k) => !dates.some((d) => d.property === k))
          .map((k) => `"${k}"`)
          .join(" | ")}> & { ${dates.map((d) => `${d.property}: string`).join("; ")} }`
      : `Pick<${model}, ${rowKeys.map((k) => `"${k}"`).join(" | ")}>`
  };

/**
 * ${o.url} — ${owner ? `the signed-in user's ${records}` : `every ${record}`}: list, create, edit and delete them.
 *
 * The page is live: each action runs on the server over Flow's WebSocket, and the list
 * re-renders in place.${owner ? ` Every read and write goes through \`owned()\`, so nobody\n * sees or changes a ${record} that is not theirs.` : ""}
 */
export class ${name} extends ${parts.extends} {
${_staticsBlock(parts)}  @locked items: Row[] = [];
  @expose editingId: number | null = null;
${fieldLines.map((line) => `${line}\n`).join("")}${parts.layoutMethod}
  override async onMount(): Promise<void> {
    await this.load();
  }

  /** ${owner ? `The signed-in user's ${records}, and nobody else's.` : `The ${records} the page works on.`} */
  private owned() {
    return ${owned};
  }

  private async load(): Promise<void> {
    const found = await this.owned().orderBy("id", "desc").get();
    this.items = found.map((${record}) => ({
${rowKeys.map((k) => `      ${k}: ${fromModel(k)},`).join("\n")}
    }));
  }

  @expose async save(): Promise<void> {
${first ? "    await this.validate();\n\n" : ""}    if (this.editingId === null) {
      const ${record} = new ${model}();
      ${record}.fill(${data});${owner ? `\n      ${record}.${owner.property} = ${userId};` : ""}
      await ${record}.save();
    } else {
      const ${record} = await this.owned().where("id", this.editingId).firstOrFail();
      ${record}.fill(${data});
      await ${record}.save();
    }

    this.reset();
    this.refresh(); // runs onMount() again, so the list shows the change
    this.flash("Saved.");
  }

  @expose edit(id: number): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    this.editingId = id;${fields.length ? `\n${assignFrom("item")}` : ""}
  }

  @expose async destroy(id: number): Promise<void> {
    const ${record} = await this.owned().where("id", id).firstOrFail();
    await ${record}.delete();
    this.refresh();
    this.flash("Deleted.");
  }

  @expose reset(): void {
    this.editingId = null;${fields.length ? `\n${clear}` : ""}
    this.resetValidation();
  }

  override async render() {
    return (
      <div class="mx-auto max-w-2xl space-y-6">
        <h1 ${_cls(o.styles, "PAGE_TITLE", "text-2xl font-bold")}>${_label(name.replace(/Page$/, ""))}</h1>

        <form onSubmit={this.save} class="flex flex-wrap items-start gap-2">
${controls ? `${controls}\n` : ""}          <button type="submit" loadingAttr="disabled" ${_btn(o.styles, "primary")}>
            {this.editingId === null ? "Add" : "Update"}
          </button>
          {this.editingId !== null && (
            <button type="button" onClick={this.reset} ${_btn(o.styles, "secondary")}>
              Cancel
            </button>
          )}
        </form>

        <ul class="divide-y divide-border">
          {this.items.map((item) => (
            <li key={String(item.id)} class="flex items-center justify-between gap-4 py-3">
              <span class="min-w-0 flex-1 truncate">${shown}</span>${dates
                .map(
                  (d) =>
                    `\n              <span class="text-sm text-muted-foreground">{item.${d.property}}</span>`,
                )
                .join("")}
              <span class="flex shrink-0 gap-3">
                <button type="button" onClick={() => this.edit(item.id)} ${_btn(o.styles, "secondary")}>
                  Edit
                </button>
                <button type="button" onClick={() => this.destroy(item.id)} confirm="Delete this?" ${_btn(o.styles, "danger")}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
}
`;
  return _importUsedUi(source, o.styles);
}

/**
 * Import from the app's `lib/ui` only the class lists the page ended up using. A model with
 * no boolean column draws no checkbox, and an import nothing reads fails the app's lint.
 */
function _importUsedUi(source: string, styles: _AppStyles | undefined): string {
  if (!styles) return source;
  const line = (names: string[]) => `import { ${names.join(", ")} } from "${styles.ui}";\n`;
  const all = [...styles.names].sort();
  const used = all.filter((name) => source.includes(`class={${name}}`));
  return source.replace(line(all), used.length > 0 ? line(used) : "");
}
