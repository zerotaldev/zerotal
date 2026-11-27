---
title: Add a Model
description: Milestone 2 of the tutorial — generate the Task model and its migration, give the table its columns, and run it.
---

# Add a Model

Milestone 2 of 9 in [Build Your First App](/docs/tutorial).

A task belongs to a project, has a title, can be ticked off, and can be assigned to
someone. In this app [migrations](/docs/migrations) own the schema, so the table needs
one as well as the [model](/docs/orm).

## Generate both

```bash
# in your project root
bun zt make:model Task -m
```

```
Created: app/models/Task.ts
Created: database/migrations/0007_create_tasks_table.ts
```

The generators write a starting point, not the finished file. Replace both.

## The migration

```ts
// database/migrations/0007_create_tasks_table.ts
import { Migration, Schema } from "zerotal/orm";

export default class CreateTasksTable extends Migration {
  override async up(): Promise<void> {
    await Schema.create("tasks", (table) => {
      table.increments("id");
      // Every list of tasks is one project's.
      table.integer("project_id").index();
      table.string("title");
      table.boolean("done").default(false);
      table.integer("assignee_id").nullable().index();
      table.timestamps();
    });
  }

  override async down(): Promise<void> {
    await Schema.drop("tasks");
  }
}
```

## The model

```ts
// app/models/Task.ts
import { Model, column, table } from "zerotal/orm";

/** A piece of work inside a project. Whoever owns the project owns its tasks. */
@table("tasks")
export class Task extends Model {
  // The project and the assignee are not on this list: the route sets them in code.
  static override fillable = ["title", "done"] as const;

  @column({ type: "number" }) projectId!: number;
  @column({ type: "string" }) title!: string;
  @column({ type: "boolean", default: false }) done!: boolean;
  @column({ type: "number", nullable: true }) assigneeId?: number | null | undefined;

  /** What a page is sent. */
  toPage(): TaskData {
    return { id: this.id, title: this.title, done: Boolean(this.done) };
  }
}

/** A task as the pages receive it. Mirrored in resources/js/types.ts. */
export interface TaskData {
  id: number;
  title: string;
  done: boolean;
}
```

Three things here follow `app/models/Project.ts`:

- **`fillable` lists only what a form may set.** `projectId` and `assigneeId` are left
  off, so no field in a request can move a task into someone else's project. The route
  assigns them in code.
- **Attributes are camelCase, columns snake_case.** `projectId` is stored in
  `project_id`. The ORM maps one to the other.
- **`toPage()` decides what a page receives**, so a column added later is not sent to
  the browser until you say so.

A nullable column is declared `?: T | null | undefined`: the starter turns on
`exactOptionalPropertyTypes`, under which clearing the field would not otherwise
typecheck.

## Run it

```bash
# in your project root
bun zt migrate
```

```
Migrated 1 migration(s).
  0007_create_tasks_table    ran
```

## Check it

`bun zt migrate:status` now lists `0007_create_tasks_table` as run. To see the table
itself, open the REPL, which boots the app with `DB` in scope:

```bash
# in your project root
bun zt repl
```

```
zerotal> await DB.table("tasks").get()
[]
```

An empty list: the table exists and has no rows yet. Anything else can be imported at the
prompt, the framework's modules and the app's own files alike, the way a file at the app's root
would import them:

```
zerotal> import { Task } from "./app/models/Task"
zerotal> await Task.query().count()
0
```

Type `.exit` to leave.

**Next:** [Routes and pages](/docs/tutorial/routes-and-pages).
