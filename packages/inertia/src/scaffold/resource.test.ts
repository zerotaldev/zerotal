import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _requiredComponents } from "./client.ts";
import { _readResourceModel } from "./fields.ts";
import { _resourceNames } from "./names.ts";
import { _makeResource } from "./resource.ts";

const cwd = process.cwd();
const dirs: string[] = [];
afterEach(async () => {
  process.chdir(cwd);
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

const TASK = `import { Model, column, table } from "zerotal/orm";

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
type Size = "s" | "m";

@table("tasks")
export class Task extends Model {
  static override fillable = ["name", "notes", "done", "dueOn", "startsAt", "priority", "size", "kind", "estimate", "meta"] as const;

  @column({ type: "number" }) userId!: number;
  @column({ type: "string" }) name!: string;
  @column({ type: "text", nullable: true }) notes?: string | null | undefined;
  @column({ type: "boolean", default: true }) done!: boolean;
  @column("date") dueOn?: Date | null | undefined;
  @column({ type: "datetime" }) startsAt!: Date;
  @column({ type: "string", default: "normal" }) priority!: TaskPriority;
  @column({ type: "string" }) size!: Size;
  @column({ type: "string" }) kind!: "bug" | "feature";
  @column({ type: "number", nullable: true }) estimate?: number | null | undefined;
  @column({ type: "json" }) meta!: Record<string, unknown>;
}
`;

const NOTE = `import { Model, column, table } from "zerotal/orm";

@table("notes")
export class Note extends Model {
  static override fillable = ["body"] as const;
  @column({ type: "string" }) body!: string;
}
`;

/** An app laid out like the React or Vue starter, with a Task and a Note model. */
async function starter(framework: "react" | "vue"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "makeresource-"));
  dirs.push(root);
  for (const file of _requiredComponents(framework)) {
    await Bun.write(join(root, "resources/js", file), "");
  }
  await Bun.write(join(root, "resources/js/pages/home.tsx"), "export default function Home() {}\n");
  await Bun.write(join(root, "app/routes/(auth)/(verified)/_middleware.ts"), "");
  await Bun.write(join(root, "app/models/Task.ts"), TASK);
  await Bun.write(join(root, "app/models/Note.ts"), NOTE);
  await Bun.write(join(root, "app/models/User.ts"), "export class User {}\n");
  await Bun.write(join(root, "tests/support.ts"), "export async function bootApp() {}\n");
  if (framework === "vue") await Bun.write(join(root, "tests/render.ts"), "");
  await Bun.write(join(root, "database/factories/UserFactory.ts"), "");
  await Bun.write(join(root, "types/routes.generated.ts"), "");
  await Bun.write(
    join(root, "tsconfig.json"),
    `{ "compilerOptions": { "paths": { "@app/*": ["./app/*"] } } }\n`,
  );
  await Bun.write(join(root, "package.json"), `{ "dependencies": { "zerotal": "*" } }\n`);
  process.chdir(root);
  return root;
}

function collector() {
  const lines: string[] = [];
  return {
    lines,
    out: {
      info: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m),
      dim: (m: string) => lines.push(m),
      error: (m: string) => lines.push(`error: ${m}`),
    },
  };
}

const read = (root: string, file: string) => readFileSync(join(root, file), "utf8");

describe("the model make:resource reads", () => {
  it("gives each column the input its types call for", async () => {
    const root = await starter("react");
    const { model, skipped } = _readResourceModel("Task", root)!;
    const kinds = Object.fromEntries(model.fields.map((f) => [f.property, f.kind]));

    expect(kinds).toEqual({
      name: "string",
      notes: "text",
      done: "boolean",
      dueOn: "date",
      startsAt: "datetime",
      priority: "enum",
      size: "enum",
      kind: "enum",
      estimate: "number",
    });
    expect(model.table).toBe("tasks");
    expect(model.owner?.column).toBe("user_id");
    expect(skipped).toEqual(["meta: Record<string, unknown>"]);
  });

  it("reads an enum's values from a literal union, an alias, or an exported constant", async () => {
    const root = await starter("react");
    const fields = _readResourceModel("Task", root)!.model.fields;
    const field = (p: string) => fields.find((f) => f.property === p)!;

    expect(field("priority")).toMatchObject({
      options: ["low", "normal", "high"],
      optionsConst: "TASK_PRIORITIES",
      defaultValue: "normal",
    });
    expect(field("size").options).toEqual(["s", "m"]);
    expect(field("kind").options).toEqual(["bug", "feature"]);
    expect(field("done").defaultValue).toBe(true);
  });
});

describe("the names a resource goes by", () => {
  it("is the model's plural by default", () => {
    expect(_resourceNames("Task", "Task")).toMatchObject({
      record: "task",
      records: "tasks",
      segment: "tasks",
      title: "Tasks",
      component: "Task",
    });
  });

  it("keeps a name already in the plural, and splits a compound one", () => {
    expect(_resourceNames("Chores", "Task")).toMatchObject({
      segment: "chores",
      record: "task",
      component: "Chore",
    });
    expect(_resourceNames("BlogPost", "BlogPost")).toMatchObject({
      segment: "blog-posts",
      record: "blogPost",
      singular: "blog post",
      title: "Blog posts",
    });
  });
});

describe("make:resource --model in a React app", () => {
  it("writes owner-scoped routes, a request, a policy, the pages, the form and a test", async () => {
    const root = await starter("react");
    const { out, lines } = collector();

    expect(
      await _makeResource(out, { name: "Task", model: "Task", routeTypes: false, cwd: root }),
    ).toBe(true);

    const base = "app/routes/(auth)/(verified)/tasks";
    for (const file of [
      `${base}/index.ts`,
      `${base}/create.ts`,
      `${base}/[task]/edit.ts`,
      `${base}/[task]/index.ts`,
      "app/requests/TaskRequest.ts",
      "app/policies/TaskPolicy.ts",
      "resources/js/lib/tasks.ts",
      "resources/js/Components/TaskForm.tsx",
      "resources/js/pages/tasks/index.tsx",
      "resources/js/pages/tasks/create.tsx",
      "resources/js/pages/tasks/edit.tsx",
      "tests/tasks.test.ts",
    ]) {
      expect(existsSync(join(root, file))).toBe(true);
      expect(lines).toContain(`Created: ${file}`);
    }

    const index = read(root, `${base}/index.ts`);
    expect(index).toContain('.where("user_id", Auth.user().id)');
    expect(index).toContain("task.userId = Auth.user().id;");
    expect(index).toContain('Inertia.render("tasks/index"');
    expect(index).toContain("dueOn: task.dueOn ? task.dueOn.toISOString().slice(0, 10) : null");
    expect(index).toContain("startsAt: localDateTime(task.startsAt)");
    expect(read(root, `${base}/[task]/edit.ts`)).toContain('Gate.authorize("update", task);');
    expect(read(root, `${base}/[task]/edit.ts`)).toContain(
      'meta = { GET: { name: "tasks.edit" } }',
    );
    expect(read(root, `${base}/[task]/index.ts`)).toContain('Gate.authorize("delete", task);');
    expect(read(root, "app/policies/TaskPolicy.ts")).toContain("return task.userId === user.id;");

    const request = read(root, "app/requests/TaskRequest.ts");
    expect(request).toContain("priority: r.string().in([...TASK_PRIORITIES])");
    expect(request).toContain('kind: r.string().in(["bug", "feature"])');
    expect(request).toContain("done: r.boolean().default(false)");
    expect(request).toContain("dueOn: r.date().nullable().optional()");
    expect(request).toContain("notes: r.string().trim().max(5000).optional()");

    const form = read(root, "resources/js/Components/TaskForm.tsx");
    expect(form).toContain('type="date"');
    expect(form).toContain('type="datetime-local"');
    expect(form).toContain('type="number"');
    expect(form).toContain("<Checkbox");
    expect(form).toContain("<SelectField");
    expect(form).toContain("<TextAreaField");
    expect(form).toContain('(task?.priority ?? "normal") as TaskPriority');
    expect(form).toContain("done: task?.done ?? true");

    expect(read(root, "resources/js/pages/tasks/index.tsx")).toContain(
      "<AppLayout>{page}</AppLayout>",
    );

    const test = read(root, "tests/tasks.test.ts");
    expect(test).toContain('import { bootApp } from "./support";');
    expect(test).toContain('import { renderPage } from "@zerotal/inertia/testing";');
    expect(test).toContain('test("forbids another user from seeing, changing or deleting a task"');

    // Every framework import goes through the bundle the app declares.
    for (const file of [`${base}/index.ts`, "app/requests/TaskRequest.ts", "tests/tasks.test.ts"]) {
      expect(read(root, file)).not.toMatch(/from "@zerotal\/(?!inertia)/);
    }
  });

  it("writes nothing when a file it would write is already there", async () => {
    const root = await starter("react");
    await Bun.write(join(root, "resources/js/pages/tasks/index.tsx"), "");
    const { out, lines } = collector();

    expect(
      await _makeResource(out, { name: "Task", model: "Task", routeTypes: false, cwd: root }),
    ).toBe(false);
    expect(lines.join("\n")).toContain("resources/js/pages/tasks/index.tsx");
    expect(existsSync(join(root, "app/requests/TaskRequest.ts"))).toBe(false);
  });

  it("says so when the model is not there", async () => {
    const root = await starter("react");
    const { out, lines } = collector();

    expect(
      await _makeResource(out, { name: "Post", model: "Post", routeTypes: false, cwd: root }),
    ).toBe(false);
    expect(lines.join("\n")).toContain("make:model Post");
  });

  it("names the starter components an app is missing", async () => {
    const root = await starter("react");
    await rm(join(root, "resources/js/Components/Modal.tsx"));
    const { out, lines } = collector();

    expect(
      await _makeResource(out, { name: "Task", model: "Task", routeTypes: false, cwd: root }),
    ).toBe(false);
    expect(lines.join("\n")).toContain("resources/js/Components/Modal.tsx");
  });

  it("leaves a model with no owner unscoped, and says so", async () => {
    const root = await starter("react");
    const { out, lines } = collector();

    expect(
      await _makeResource(out, { name: "Note", model: "Note", routeTypes: false, cwd: root }),
    ).toBe(true);
    const index = read(root, "app/routes/(auth)/(verified)/notes/index.ts");
    expect(index).not.toContain("Auth");
    expect(read(root, "app/routes/(auth)/(verified)/notes/[note]/index.ts")).not.toContain("Gate");
    expect(existsSync(join(root, "app/policies/NotePolicy.ts"))).toBe(false);
    expect(lines.join("\n")).toContain("Note has no userId column");
  });
});

describe("make:resource --model in a Vue app", () => {
  it("writes .vue pages and a test that loads them once the app has booted", async () => {
    const root = await starter("vue");
    const { out } = collector();

    expect(
      await _makeResource(out, {
        name: "Task",
        model: "Task",
        framework: "vue",
        routeTypes: false,
        cwd: root,
      }),
    ).toBe(true);

    const form = read(root, "resources/js/Components/TaskForm.vue");
    expect(form).toContain('<TextField v-model="form.dueOn" label="Due on" type="date"');
    expect(form).toContain('<Checkbox v-model="form.done" label="Done" />');
    expect(form).toContain('<SelectField v-model="form.priority"');
    expect(read(root, "resources/js/pages/tasks/index.vue")).toContain(
      'defineOptions({ name: "TasksIndex", layout: AppLayout });',
    );
    const test = read(root, "tests/tasks.test.ts");
    expect(test).toContain('import { renderPage } from "./render";');
    expect(test).toContain("let IndexPage: Component;");
    expect(test).toContain(
      'IndexPage = (await import("../resources/js/pages/tasks/index.vue")).default;',
    );
  });
});
