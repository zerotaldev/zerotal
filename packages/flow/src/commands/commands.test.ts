import { describe, it, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { MakeFlowCommand } from "./MakeFlowCommand.ts";

class Collector {
  out = "";
  write(s: string) {
    this.out += s;
  }
  writeLine(s: string) {
    this.out += s + "\n";
  }
  writeError(s: string) {
    this.out += s + "\n";
  }
}

const tmpDirs: string[] = [];
async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "makeflow-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true });
});

function mk(
  args: Record<string, string>,
  flags: Record<string, unknown>,
): { c: MakeFlowCommand; col: Collector } {
  const c = new MakeFlowCommand();
  const col = new Collector();
  (c as unknown as { _writer: unknown })._writer = col;
  (c as unknown as { args: Record<string, string> }).args = args;
  (c as unknown as { flags: Record<string, unknown> }).flags = flags;
  return { c, col };
}

describe("make:flow — page", () => {
  it("scaffolds a Component page with an exposed field + action", async () => {
    const dir = await freshDir();
    const { c, col } = mk({ name: "Dashboard" }, { dir });
    await c.run();

    const path = join(dir, "dashboard.tsx");
    expect(await Bun.file(path).exists()).toBe(true);
    // The exact name, which a case-insensitive file system (Windows, macOS) would not check:
    // file routing is case-sensitive, so Dashboard.tsx would be served at /Dashboard.
    expect(readdirSync(dir)).toContain("dashboard.tsx");
    const src = await Bun.file(path).text();
    expect(src).toContain("/** @jsxImportSource @zerotal/flow */");
    expect(src).toContain("export class Dashboard extends Component");
    expect(src).toContain("@expose count = 0");
    expect(src).toContain("increment(): void");
    expect(src).not.toContain("static layout"); // no layout by default
    // Route hint uses the kebab-cased class name.
    expect(col.out).toContain('Router.flow("/dashboard", Dashboard)');
  });

  it("refuses to overwrite an existing file", async () => {
    const dir = await freshDir();
    await c_run(dir, { name: "Dashboard" }, { dir });
    const { c, col } = mk({ name: "Dashboard" }, { dir });
    await c.run();
    expect(col.out).toContain("File already exists");
  });
});

describe("make:flow — layout + nesting", () => {
  it("writes a nested page and computes the layout import depth", async () => {
    const dir = await freshDir();
    const { c, col } = mk({ name: "Users/Index" }, { dir, layout: "AppLayout" });
    await c.run();

    const path = join(dir, "users", "index.tsx");
    expect(await Bun.file(path).exists()).toBe(true);
    const src = await Bun.file(path).text();
    // Two segments deep → two `../` up to the layouts folder, beside the pages folder.
    expect(src).toContain('import { AppLayout } from "../../layouts/AppLayout"');
    expect(src).toContain("static layout = AppLayout;");
    // users/index.tsx is served at /users, so that is the address it prints.
    expect(col.out).toContain('Router.flow("/users", Index)');
    // There is no such layout in this directory, and the command says so.
    expect(col.out).toContain("No layout exports AppLayout");
  });
});

/**
 * In a starter app: `AppLayout` lives in `app/flow/layouts/app.tsx`, and `make:flow --crud
 * --layout AppLayout` imported `../layouts/AppLayout.tsx`. That failed to compile and, at boot,
 * left the route a 404 behind one log line. The CRUD page was also all TODOs around an `Item`
 * shape, with no way to point it at a model.
 */
describe("make:flow in an app laid out like the starters", () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  async function starter(): Promise<string> {
    const root = await freshDir();
    await Bun.write(
      join(root, "app/flow/layouts/app.tsx"),
      "export class AppLayout extends Layout {}\n",
    );
    await Bun.write(join(root, "app/flow/pages/home.tsx"), "export class Home {}\n");
    await Bun.write(
      join(root, "app/models/Post.ts"),
      "@table('posts')\nexport class Post extends Model {\n  static override fillable = ['name'] as const;\n  @column() name!: string;\n}\n",
    );
    process.chdir(root);
    return root;
  }

  it("imports the layout from the file that exports it", async () => {
    const root = await starter();
    const { c, col } = mk({ name: "Posts" }, { crud: true, layout: "AppLayout" });
    await c.run();

    const src = await Bun.file(join(root, "app/flow/pages/posts.tsx")).text();
    expect(src).toContain('import { AppLayout } from "../layouts/app";');
    expect(col.out).not.toContain("No layout exports");
  });

  it("with --model, lists, creates, edits and deletes that model, with nothing left to fill in", async () => {
    const root = await starter();
    const { c, col } = mk({ name: "Posts" }, { crud: true, layout: "AppLayout", model: "Post" });
    await c.run();

    const src = await Bun.file(join(root, "app/flow/pages/posts.tsx")).text();
    expect(src).toContain('import { Post } from "../../models/Post";');
    expect(src).toContain("@locked items: Row[] = [];");
    expect(src).toContain('type Row = Pick<Post, "id" | "name">;');
    expect(src).toContain("const post = new Post();");
    expect(src).toContain("post.fill({ name: this.name });");
    expect(src).toContain("await post.delete();");
    expect(src).not.toContain("TODO");
    expect(col.out).not.toContain("No model exports");
    expect(() => new Bun.Transpiler({ loader: "tsx" }).transformSync(src)).not.toThrow();
  });

  it("says so when the model it was told to use does not exist", async () => {
    await starter();
    const { c, col } = mk({ name: "Tags" }, { crud: true, model: "Tag" });
    await c.run();

    expect(col.out).toContain("No model exports Tag in app/models/");
    expect(col.out).toContain("make:model Tag --migration");
  });
});

describe("make:flow — child", () => {
  it("scaffolds a child component whose props land on  fields", async () => {
    const dir = await freshDir();
    const { c, col } = mk({ name: "StarRating" }, { dir, child: true, layout: "AppLayout" });
    await c.run();

    const src = await Bun.file(join(dir, "StarRating.tsx")).text();
    expect(src).not.toContain("setup("); // props are assigned by the parent, no hook needed
    expect(src).toContain("@locked label");
    expect(src).not.toContain("static layout"); // layout ignored for a child
    expect(col.out).toContain("ignored for a child component");
    // A child is not a route.
    expect(col.out).not.toContain("Router.flow(");
  });
});

describe("make:flow — crud", () => {
  it("scaffolds a resourceful page with validation + list/create/edit/delete", async () => {
    const dir = await freshDir();
    const { c } = mk({ name: "Posts" }, { dir, crud: true });
    await c.run();

    const src = await Bun.file(join(dir, "posts.tsx")).text();
    expect(src).toContain("@validate((rule) => rule.required().min(2))");
    expect(src).toContain("async save()");
    expect(src).toContain("edit(id: number)");
    expect(src).toContain("async destroy(id: number)");
    expect(src).toContain("this.resetValidation()");
    expect(src).toContain("error={this.errors.name}");
  });
});

/** Run a command once (used to pre-create a file for the overwrite test). */
async function c_run(
  _dir: string,
  args: Record<string, string>,
  flags: Record<string, unknown>,
): Promise<void> {
  const { c } = mk(args, flags);
  await c.run();
}

// From the 1.18.0 starter walk: in the Flow starter, `make:flow TasksPage --crud --model Task`
// printed "File-based routing serves this automatically" and /tasks was a 404 (the starter serves
// pages from routes/web.ts only); the page assumed a `name` column (four type errors on a model
// without one), listed `Task.all()` — everyone's tasks — and extended `Component`, not the
// starter's `Page`.
describe("make:flow --crud --model in the Flow starter", () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  async function flowStarter(bootstrap?: string): Promise<string> {
    const root = await freshDir();
    await Bun.write(
      join(root, "bootstrap/app.ts"),
      bootstrap ??
        `Application.create({ providers })
  .routing({ web: basePath("routes/web.ts") })
  .fileBasedRouting({ web: basePath("app/routes") });
`,
    );
    await Bun.write(join(root, "routes/web.ts"), 'Router.flow("/", HomePage).name("home");\n');
    await Bun.write(
      join(root, "app/flow/lib/page.ts"),
      "export function titled(title: string) { return () => title; }\n" +
        "export abstract class Page extends Component {}\n",
    );
    await Bun.write(
      join(root, "app/flow/layouts/AppLayout.tsx"),
      "export function AppLayout({ shell }: { shell: Shell }) {}\n",
    );
    await Bun.write(join(root, "app/flow/pages/home.tsx"), "export class HomePage {}\n");
    await Bun.write(
      join(root, "app/models/Task.ts"),
      `@table("tasks")
export class Task extends Model {
  static override fillable = ["title", "notes", "done", "status"] as const;
  @column({ type: "number" }) userId!: number;
  @column({ type: "string" }) title!: string;
  @column({ type: "text", nullable: true }) notes?: string | null | undefined;
  @column({ type: "boolean" }) done!: boolean;
  @column({ type: "string" }) status!: TaskStatus;
}
`,
    );
    process.chdir(root);
    return root;
  }

  async function generate(root: string): Promise<{ src: string; out: string }> {
    const { c, col } = mk({ name: "TasksPage" }, { crud: true, model: "Task" });
    await c.run();
    return { src: await Bun.file(join(root, "app/flow/pages/tasks.tsx")).text(), out: col.out };
  }

  it("says how to give the page a URL, since nothing serves it by itself", async () => {
    const { out } = await generate(await flowStarter());

    expect(out).not.toContain("serves this automatically");
    expect(out).toContain("Nothing serves /tasks yet. Add the page to routes/web.ts:");
    expect(out).toContain('import { TasksPage } from "../app/flow/pages/tasks";');
    expect(out).toContain('Router.flow("/tasks", TasksPage).name("tasks");');
    expect(out).toContain("inside the signed-in group");
  });

  it("says file-based routing serves it when the app routes its pages that way", async () => {
    const root = await flowStarter(
      'Application.create({}).fileBasedRouting({ web: basePath("app/flow/pages") });\n',
    );
    const { out } = await generate(root);

    expect(out).toContain("File-based routing serves it at /tasks.");
    expect(out).not.toContain("Nothing serves");
  });

  it("edits the model's own columns, not a `name` it does not have", async () => {
    const { src } = await generate(await flowStarter());

    expect(src).not.toMatch(/\bname\b/);
    expect(src).toContain('type Row = Pick<Task, "id" | "title" | "notes" | "done">;');
    expect(src).toContain('@expose @validate((rule) => rule.required()) title = "";');
    expect(src).toContain('@expose notes = "";');
    expect(src).toContain("@expose done = false;");
    expect(src).toContain("task.fill({ title: this.title, notes: this.notes, done: this.done });");
    expect(src).toContain('this.notes = item.notes ?? "";');
    expect(src).toContain('<input type="checkbox" checked={this.done} class="size-4" />');
    // A union of literals has no value a blank form could start from; it is left to its default.
    expect(src).not.toContain("status");
  });

  it("reads and writes only the signed-in user's records", async () => {
    const { src } = await generate(await flowStarter());

    expect(src).not.toContain("Task.all()");
    expect(src).toContain('return Task.query().where("user_id", this.user?.id ?? 0);');
    expect(src).toContain("task.userId = this.user?.id ?? 0;");
    expect(src).toContain('await this.owned().where("id", this.editingId).firstOrFail();');
    expect(src).toContain('await this.owned().where("id", id).firstOrFail();');
  });

  it("extends the starter's Page, in its layout, and is live", async () => {
    const { src } = await generate(await flowStarter());

    expect(src).toContain('import { Page, titled } from "../lib/page";');
    expect(src).toContain("export class TasksPage extends Page {");
    expect(src).toContain("static override interactive = true;");
    expect(src).toContain('static override title = titled("Tasks");');
    expect(src).toContain('import { AppLayout } from "../layouts/AppLayout";');
    expect(src).toContain("return <AppLayout shell={this.shell()}>{page}</AppLayout>;");
    expect(src).not.toContain("Component");
    expect(() => new Bun.Transpiler({ loader: "tsx" }).transformSync(src)).not.toThrow();
  });

  it("scopes by the signed-in user through Auth on a page without the starter's base", async () => {
    const root = await flowStarter();
    await rm(join(root, "app/flow/lib"), { recursive: true, force: true });
    const { src } = await generate(root);

    expect(src).toContain("export class TasksPage extends Component {");
    expect(src).toContain('import { Auth } from "zerotal/auth";');
    expect(src).toContain('Task.query().where("user_id", Auth.user().id)');
  });

  // From the 1.18.1 walk: a `date` column was left out, the inputs used a class no stylesheet
  // defines (`input`), so they rendered without a border, and every page carried a JSX pragma
  // that no starter page uses.
  it("edits a date column as a date, held as YYYY-MM-DD on the page", async () => {
    const root = await flowStarter();
    await Bun.write(
      join(root, "app/models/Task.ts"),
      `@table("tasks")
export class Task extends Model {
  static override fillable = ["title", "dueOn"] as const;
  @column({ type: "number" }) userId!: number;
  @column({ type: "string" }) title!: string;
  @column({ type: "date", nullable: true }) dueOn?: Date | null | undefined;
}
`,
    );
    const { src } = await generate(root);

    expect(src).toContain('type Row = Pick<Task, "id" | "title"> & { dueOn: string };');
    expect(src).toContain('dueOn: task.dueOn ? task.dueOn.toISOString().slice(0, 10) : "",');
    expect(src).toContain('@expose dueOn = "";');
    expect(src).toContain("dueOn: this.dueOn ? new Date(this.dueOn) : null");
    expect(src).toContain('<input type="date" value={this.dueOn}');
    expect(src).toContain("this.dueOn = item.dueOn;");
    expect(() => new Bun.Transpiler({ loader: "tsx" }).transformSync(src)).not.toThrow();
  });

  it("uses the starter's class lists and button styles when the app has them", async () => {
    const root = await flowStarter();
    await Bun.write(
      join(root, "app/flow/lib/ui.ts"),
      'export const INPUT = "border";\nexport const FIELD_ERROR = "text-destructive";\n' +
        'export const PAGE_TITLE = "text-2xl";\nexport const CHECKBOX = "size-4";\n',
    );
    await Bun.write(
      join(root, "app/flow/lib/button.ts"),
      'export function buttonClass(variant = "primary") { return variant; }\n',
    );
    const { src } = await generate(root);

    expect(src).toContain('import { buttonClass } from "../lib/button";');
    expect(src).toContain('import { CHECKBOX, FIELD_ERROR, INPUT, PAGE_TITLE } from "../lib/ui";');
    expect(src).toContain("<input value={this.title} class={INPUT}");
    expect(src).toContain("<span error={this.errors.title} class={FIELD_ERROR} />");
    expect(src).toContain('<button type="submit" loadingAttr="disabled" class={buttonClass()}>');
    expect(src).not.toContain('class="input');
  });

  it("imports only the class lists the page uses", async () => {
    // From the 1.18.2 walk: the starter's lib/ui.ts exports CARD, and every generated page
    // imported it and never used it.
    const root = await flowStarter();
    await Bun.write(
      join(root, "app/flow/lib/ui.ts"),
      'export const INPUT = "border";\nexport const FIELD_ERROR = "text-destructive";\n' +
        'export const PAGE_TITLE = "text-2xl";\nexport const CHECKBOX = "size-4";\n' +
        'export const CARD = "rounded-xl border";\n',
    );
    await Bun.write(
      join(root, "app/flow/lib/button.ts"),
      'export function buttonClass(variant = "primary") { return variant; }\n',
    );
    const { src } = await generate(root);

    const imported = /import \{ ([^}]+) \} from "\.\.\/lib\/ui";/.exec(src)?.[1]?.split(", ") ?? [];
    expect(imported).not.toContain("CARD");
    expect(imported.length).toBeGreaterThan(0);
    for (const name of imported) expect(src).toContain(`class={${name}}`);
  });

  it("leaves out the JSX pragma when the app's tsconfig names Flow's runtime", async () => {
    const root = await flowStarter();
    await Bun.write(
      join(root, "tsconfig.json"),
      '{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@zerotal/flow" } }\n',
    );
    const { src } = await generate(root);

    expect(src).not.toContain("@jsxImportSource");
  });
});
