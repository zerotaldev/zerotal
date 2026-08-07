/**
 * The `make:flow` command — scaffolds a Flow page or child component.
 *
 * This is the Flow counterpart to `make:controller` / `make:page`: the
 * flagship server-driven layer previously had no generator, so every
 * `Component` was hand-written. `make:flow Name` emits a ready-to-run class
 * with an `@expose`/`render` skeleton; `--child`, `--crud`, and `--layout`
 * cover the common shapes.
 */
import { Command } from "@zerotal/core";
import { existsSync } from "node:fs";

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
    const dirFlag = ((this.flags["dir"] as string | undefined) ?? "").trim();

    const componentName = name.includes("/") ? name.split("/").pop()! : name;
    const baseDir = dirFlag
      ? dirFlag.replace(/\\/g, "/").replace(/\/+$/, "")
      : _pickDir(child ? CHILD_DIRS : PAGE_DIRS);
    const path = `${baseDir}/${name}.tsx`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    // Depth relative to the pages dir, so the layout import resolves correctly:
    // a page at app/flow/pages/Foo.tsx reaches app/flow/layouts/AppLayout.tsx via ../layouts/…
    const depth = name.split("/").length;
    const prefix = "../".repeat(depth);

    let stub: string;
    if (child) {
      if (crud || layout) {
        this.warn("--crud and --layout are ignored for a child component.");
      }
      stub = _childStub(componentName);
    } else if (crud) {
      stub = _crudStub(componentName, layout, prefix);
    } else {
      stub = _pageStub(componentName, layout, prefix);
    }

    await Bun.write(path, stub);
    this.info(`Created: ${path}`);

    if (layout && !child) {
      this.dim(
        `  Layout: assumes \`export { ${layout} }\` from ${prefix}layouts/${layout}.tsx — ` +
          `adjust the import if your layout's path or export name differs.`,
      );
    }

    if (!child) {
      // File-based routing (`.fileBasedRouting("app/flow/pages")`) auto-discovers this page.
      // Show the explicit registration too, for apps that register routes by hand.
      const url = _urlFor(name);
      this.dim(
        "  File-based routing serves this automatically. To register it explicitly, add to routes/web.ts:",
      );
      this.dim(`    Router.flow("${url}", ${componentName});`);
    }
  }
}

/** First existing candidate directory, else the first candidate as the default. */
function _pickDir(candidates: string[]): string {
  return candidates.find((d) => existsSync(d)) ?? candidates[0]!;
}

/** Derive a kebab-case URL path from a (possibly nested) class name. */
function _urlFor(name: string): string {
  const segments = name.split("/").map((seg) =>
    seg
      .replace(/Page$/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase(),
  );
  const path = segments.filter(Boolean).join("/");
  return "/" + path;
}

function _layoutImport(layout: string, prefix: string): string {
  return layout ? `import { ${layout} } from "${prefix}layouts/${layout}.tsx";\n` : "";
}

function _layoutStatic(layout: string): string {
  return layout ? `  static layout = ${layout};\n\n` : "";
}

/** A minimal page: one exposed field, one action, a render. */
function _pageStub(name: string, layout: string, prefix: string): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component, expose } from "@zerotal/flow";
${_layoutImport(layout, prefix)}
export class ${name} extends Component {
${_layoutStatic(layout)}  @expose count = 0;

  @expose increment(): void {
    this.count++;
  }

  override async render() {
    return (
      <div>
        <h1>${name}</h1>
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
  return `/** @jsxImportSource @zerotal/flow */
import { Component, expose, locked } from "@zerotal/flow";

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
function _crudStub(name: string, layout: string, prefix: string): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component, expose, locked, validate } from "@zerotal/flow";
${_layoutImport(layout, prefix)}
// TODO: swap this shape for your model type.
interface Item {
  id: number;
  name: string;
}

export class ${name} extends Component {
${_layoutStatic(layout)}  @locked items: Item[] = [];
  @expose editingId: number | null = null;
  @expose @validate((rule) => rule.required().min(2)) name = "";

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
