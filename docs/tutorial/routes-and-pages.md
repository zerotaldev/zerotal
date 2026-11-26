---
title: Add Routes and Pages
description: Milestone 3 of the tutorial — a page for each project that lists its tasks, a form that adds one, and routes to tick a task off and delete it.
---

# Add Routes and Pages

Milestone 3 of 9 in [Build Your First App](/docs/tutorial).

The starter has a list of projects and an edit form, but no page for a single project.
This milestone adds one, with the project's tasks on it.

| Method   | URL                        | What it does            | File                          |
| -------- | -------------------------- | ----------------------- | ----------------------------- |
| `GET`    | `/projects/:project`       | The project and tasks   | `projects/[project]/index.ts` |
| `POST`   | `/projects/:project/tasks` | Add a task              | `projects/[project]/tasks.ts` |
| `PATCH`  | `/tasks/:task`             | Tick it off, or back on | `tasks/[task].ts`             |
| `DELETE` | `/tasks/:task`             | Delete it               | `tasks/[task].ts`             |

All four live under `app/routes/(auth)/(verified)/`, the group whose
`_middleware.ts` already requires a signed-in user with a confirmed email address. The
file path is the URL, and an exported `GET`, `POST`, `PATCH` or `DELETE` function is
the handler for that method. [Routing](/docs/routing) covers the rules.

`:project` and `:task` arrive as loaded models — `Project` and `Task` are found by the
parameter's name — or the request is answered with a 404 before your code runs. See
[route-model binding](/docs/routing#route-model-binding).

## The form request

Validation gets its own milestone. For now, a [form request](/docs/validator) that
only says a title is a string:

```bash
# in your project root
bun zt make:request TaskRequest
```

```ts
// app/requests/TaskRequest.ts
import { FormRequest } from "zerotal/validator";
import type { RuleBuilder } from "zerotal/validator";

/** What the "add a task" form must contain. */
export class TaskRequest extends FormRequest {
  rules(r: RuleBuilder) {
    return {
      title: r.string(),
    };
  }
}
```

## The routes

Add a `GET` to the file that already handles `PUT` and `DELETE` for a project. It
checks the project policy's `view` ability, so only the owner gets past it, and renders
a page that does not exist yet:

```ts fragment
// app/routes/(auth)/(verified)/projects/[project]/index.ts — add to the top
import { Inertia } from "@zerotal/inertia";
import { Task } from "@app/models/Task";

// GET /projects/:project — the project and its tasks, oldest first.
export const GET = async (http: HttpContext<{ project: Project }>) => {
  const project = http.params.project;
  Gate.authorize("view", project);

  const tasks = await Task.query().where("project_id", project.id).orderBy("id").get();

  return Inertia.render("projects/show", {
    title: project.name,
    project: project.toPage(),
    tasks: tasks.map((task) => task.toPage()),
  });
};
```

The file already imports `HttpContext`, `Gate` and the `Project` type.

Adding a task is a new file. The project comes from the URL and is checked against the
policy's `update` ability; the task's `projectId` is set in code:

```ts fragment
// app/routes/(auth)/(verified)/projects/[project]/tasks.ts
import type { HttpContext } from "zerotal";
import { Gate } from "zerotal/auth";
import type { Project } from "@app/models/Project";
import { Task } from "@app/models/Task";
import { TaskRequest } from "@app/requests/TaskRequest";

// POST /projects/:project/tasks — add a task to the project.
export async function POST(http: HttpContext<{ project: Project }>): Promise<void> {
  const project = http.params.project;
  Gate.authorize("update", project);
  const data = await TaskRequest.validate();

  const task = new Task();
  task.fill({ title: data.title });
  // Set in code, never from the form.
  task.projectId = project.id;
  await task.save();

  http.flash("success", `“${task.title}” was added.`);
  http.redirect(`/projects/${project.id}`, 303);
}
```

Ticking a task off and deleting it share a file:

```ts fragment
// app/routes/(auth)/(verified)/tasks/[task].ts
import type { HttpContext } from "zerotal";
import type { Task } from "@app/models/Task";

// PATCH /tasks/:task — tick a task off, or back on.
export async function PATCH(http: HttpContext<{ task: Task }>): Promise<void> {
  const task = http.params.task;

  task.done = !task.done;
  await task.save();

  http.redirect(`/projects/${task.projectId}`, 303);
}

// DELETE /tasks/:task
export async function DELETE(http: HttpContext<{ task: Task }>): Promise<void> {
  const task = http.params.task;

  await task.delete();

  http.flash("success", `“${task.title}” was deleted.`);
  http.redirect(`/projects/${task.projectId}`, 303);
}
```

> **Warning** — These two handlers check nothing: anyone signed in can tick off or
> delete any task by its id. That is deliberate for now, and it is the hole
> [milestone 5](/docs/tutorial/policy) closes with a policy.

Regenerate the route types, so the pages can call `route("projects.show", …)` with
type-checked names and parameters:

```bash
# in your project root
bun zt route:types
```

## The page

```bash
# in your project root
bun zt make:page projects/show
```

Replace the generated component. It is built from the starter's own components, the
same ones the edit page uses:

```tsx fragment
// resources/js/pages/projects/show.tsx
import type { FormEvent, ReactNode } from "react";
import { Head, router, useForm } from "@inertiajs/react";
import AppLayout from "../../Layouts/AppLayout";
import { Button } from "../../Components/Button";
import { Card, CardBody } from "../../Components/Card";
import { TextField } from "../../Components/Field";
import { TrashIcon } from "../../Components/Icon";
import { PageHeader } from "../../Components/PageHeader";
import type { Project, Task } from "../../types";

interface Props {
  title: string;
  project: Project;
  tasks: Task[];
}

function ShowProject({ title, project, tasks }: Props) {
  const form = useForm({ title: "" });

  function add(event: FormEvent) {
    event.preventDefault();
    form.post(route("projects.tasks.store", { project: project.id }), {
      preserveScroll: true,
      onSuccess: () => form.reset(),
    });
  }

  return (
    <>
      <Head title={title} />
      <div className="max-w-2xl space-y-6">
        <PageHeader
          title={project.name}
          description={project.description}
          back={{ href: route("projects"), label: "Projects" }}
        />

        <Card>
          <ul className="divide-y divide-border">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 px-5 py-3">
                <input
                  type="checkbox"
                  aria-label={`Done: ${task.title}`}
                  checked={task.done}
                  onChange={() =>
                    router.patch(
                      route("tasks.update", { task: task.id }),
                      {},
                      { preserveScroll: true },
                    )
                  }
                  className="size-4 accent-primary"
                />
                <span
                  className={task.done ? "flex-1 text-muted-foreground line-through" : "flex-1"}
                >
                  {task.title}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${task.title}`}
                  onClick={() =>
                    router.delete(route("tasks.destroy", { task: task.id }), {
                      preserveScroll: true,
                    })
                  }
                >
                  <TrashIcon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          <CardBody>
            <form onSubmit={add} className="space-y-4">
              <TextField
                label="New task"
                value={form.data.title}
                error={form.errors.title}
                onChange={(e) => form.setData("title", e.target.value)}
              />
              <Button type="submit" disabled={form.processing}>
                Add task
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

ShowProject.layout = (page: ReactNode) => <AppLayout>{page}</AppLayout>;

export default ShowProject;
```

The page's props are typed from `resources/js/types.ts`. Add `Task` there, under
`Project`:

```ts
// resources/js/types.ts — add
/** A task as the server sends it (app/models/Task.ts, `toPage()`). */
export interface Task {
  id: number;
  title: string;
  done: boolean;
}
```

Last, link to the new page. In `resources/js/pages/projects/index.tsx` the project's
name links to `projects.edit`; point that first link at `projects.show` instead, and
leave the pencil button on `projects.edit`.

```bash
# in your project root
bun run typecheck
```

It finishes without errors.

> **On Vue** — `bun zt make:page projects/show` writes `projects/show.vue`, and the
> server side is the same. The component, with the starter's Vue components:
>
> ```vue
> <script setup lang="ts">
> import { Head, router, useForm } from "@inertiajs/vue3";
> import AppLayout from "../../Layouts/AppLayout.vue";
> import Button from "../../Components/Button.vue";
> import Card from "../../Components/Card.vue";
> import CardBody from "../../Components/CardBody.vue";
> import Icon from "../../Components/Icon.vue";
> import PageHeader from "../../Components/PageHeader.vue";
> import TextField from "../../Components/TextField.vue";
> import type { Project, Task } from "../../types";
>
> defineOptions({ layout: AppLayout });
> const props = defineProps<{ title: string; project: Project; tasks: Task[] }>();
>
> const form = useForm({ title: "" });
>
> function add() {
>   form.post(route("projects.tasks.store", { project: props.project.id }), {
>     preserveScroll: true,
>     onSuccess: () => form.reset(),
>   });
> }
> </script>
>
> <template>
>   <Head :title="title" />
>   <div class="max-w-2xl space-y-6">
>     <PageHeader
>       :title="project.name"
>       :description="project.description ?? undefined"
>       :back="{ href: route('projects'), label: 'Projects' }"
>     />
>     <Card>
>       <ul class="divide-y divide-border">
>         <li v-for="task in tasks" :key="task.id" class="flex items-center gap-3 px-5 py-3">
>           <input
>             type="checkbox"
>             :aria-label="`Done: ${task.title}`"
>             :checked="task.done"
>             class="size-4 accent-primary"
>             @change="
>               router.patch(route('tasks.update', { task: task.id }), {}, { preserveScroll: true })
>             "
>           />
>           <span :class="task.done ? 'flex-1 text-muted-foreground line-through' : 'flex-1'">
>             {{ task.title }}
>           </span>
>           <Button
>             variant="ghost"
>             size="icon"
>             :aria-label="`Delete ${task.title}`"
>             @click="
>               router.delete(route('tasks.destroy', { task: task.id }), { preserveScroll: true })
>             "
>           >
>             <Icon name="trash" class="size-4" />
>           </Button>
>         </li>
>       </ul>
>       <CardBody>
>         <form class="space-y-4" @submit.prevent="add">
>           <TextField v-model="form.title" label="New task" :error="form.errors.title" />
>           <Button type="submit" :disabled="form.processing">Add task</Button>
>         </form>
>       </CardBody>
>     </Card>
>   </div>
> </template>
> ```
>
> The list's link is in `projects/index.vue`. `bun run typecheck` runs `vue-tsc`.

> **On Flow** — a page is a component registered in `routes/web.ts`, not a `GET`
> export, so leave `projects/[project]/index.ts` as it is and skip `make:page`. Copy
> `app/flow/pages/projects/edit.tsx` to `show.tsx` as `ShowProjectPage`: its
> `onMount()` authorizes `view` instead of `update`, and loads the tasks onto the
> component. Register it after the edit page, inside the `verified` group:
>
> ```ts fragment
> // routes/web.ts
> Router.flow("/projects/:project", ShowProjectPage).name("projects.show");
> ```
>
> The forms are plain HTML forms that post to the same handlers as above. A browser
> form cannot send `PATCH` or `DELETE`, so give it `method="post"` and a
> `data-method`, as the project list's delete form does:
>
> ```tsx fragment
> <form method="post" action={route("tasks.update", { task: task.id })} data-method="patch">
>   <button type="submit" class={buttonClass("secondary", "sm")}>
>     {task.done ? "Undo" : "Done"}
>   </button>
> </form>
> ```
>
> The list's link is in `app/flow/pages/projects/index.tsx`.

## Check it

With `bun zt dev` running, open <http://localhost:3000/projects> and click a project's
name. The page shows its description and an empty list. Add a task: it appears in the
list with a toast saying it was added. Tick it, and it is struck through; the trash
button removes it.

**Next:** [Validation](/docs/tutorial/validation).
