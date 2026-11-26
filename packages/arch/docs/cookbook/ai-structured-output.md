---
title: AI Structured Output
description: Ask a model for a typed object with Ai.object() and a validator schema, handle an answer of the wrong shape and a refusal, and test it all with AiFake and no API key.
---

# AI Structured Output

A project in the starter has a free-text description. By the end of this recipe each
project has a **Suggest tasks** button that sends the description to a model and lists
the tasks it suggests, each with a priority. The answer comes back as an object checked
against a schema, not as prose to pick apart. An answer of the wrong shape is retried
once, a refusal gets its own message, and the tests run on `AiFake` with no network and
no API key.

## Before you start

You need the React starter with its example `Project` resource: the model, its policy,
the edit page in `resources/js/pages/projects/edit.tsx`, and the feature tests with
`bootApp()` in `tests/support.ts`.

The validator, the policy check and the test helpers come with `zerotal`, as
`zerotal/validator`, `zerotal/auth` and `zerotal/testing`, and need nothing installed.
`@zerotal/ai` is not part of that bundle. Install it, and the SDK its Anthropic driver
uses:

```bash
# in your project root
bun add @zerotal/ai@~1.18.0
bun add @anthropic-ai/sdk
```

The package is **experimental**: its API may change in a minor release, so the version
above is pinned to 1.18.

## Register and configure

Register the provider with the others:

```ts fragment
// bootstrap/providers.ts
import { AiProvider } from "@zerotal/ai";

const providers = [
  // …
  InertiaProvider,
  AiProvider,
  DevtoolsProvider,
];
```

Then say which model to use. The key comes from the environment, and the driver is
declared only when there is one:

```ts
// config/ai.ts
import { AiConfig } from "@zerotal/ai";

const apiKey = Bun.env["ANTHROPIC_API_KEY"] ?? "";

export default AiConfig({
  default: "anthropic",
  // Declared only when there is a key. With none — on a laptop, in CI — the app runs
  // with AI off, and a call fails with an error that says so, instead of the config
  // refusing to load.
  drivers: apiKey ? { anthropic: { apiKey, model: "claude-opus-5" } } : {},
  limits: { perRequestUsd: 0.5, perDayUsd: 25 },
});
```

A declared driver with an empty key is a configuration error, and the config file is
not loaded at all. Declaring no driver is a supported state instead: the app boots, and
a call fails with `AiDriverUnavailableError`, which the code below turns into a message.
So a machine without the key, such as a laptop or CI, runs the app with the feature off.

`limits` caps spend: a request estimated to cost more than `perRequestUsd` is refused
before it is sent, and so is anything past `perDayUsd` in a day.

## Ask for an object

The schema is a [validator](/docs/validator) schema, the same kind a form uses.
`Ai.object()` sends it to the model as the shape its answer must take, then checks the
answer against it before returning:

```ts fragment
// app/support/suggestions.ts
import { Ai, AiError, AiRefusedError, AiSchemaError } from "@zerotal/ai";
import type { RuleBuilder } from "zerotal/validator";
import type { Project } from "@app/models/Project";

export const PRIORITIES = ["low", "normal", "high"] as const;

/** One task the model suggests. Mirrors the schema below, which is what enforces it. */
export interface SuggestedTask {
  title: string;
  priority: (typeof PRIORITIES)[number];
}

/** What the model must answer with: one to eight tasks, each a short title and a priority. */
export const suggestionSchema = (rule: RuleBuilder) => ({
  tasks: rule
    .array(
      rule.object({
        title: rule.string().min(3).max(120),
        priority: rule.string().in([...PRIORITIES]),
      }),
    )
    .min(1)
    .max(8),
});

/** Either the tasks, or a sentence to show in their place. */
export type Suggestions = { tasks: SuggestedTask[]; error: null } | { tasks: []; error: string };

const failed = (error: string): Suggestions => ({ tasks: [], error });

/** Ask the model for next tasks, drawn from the project's description. */
export async function suggestTasks(project: Project): Promise<Suggestions> {
  const description = project.description?.trim() ?? "";
  if (!description) return failed("Add a description to the project first.");

  const request = {
    system:
      "You help plan projects. Suggest the next concrete tasks for the project described, " +
      "each with a short imperative title. Use only what the description says.",
    prompt: `Project: ${project.name}\n\nDescription:\n${description}`,
    // Extraction, not deep reasoning: low effort is cheaper and faster.
    effort: "low" as const,
    meta: { feature: "task-suggestions" },
  };

  for (let attempt = 1; ; attempt++) {
    try {
      const { tasks } = await Ai.object<{ tasks: SuggestedTask[] }>(request, suggestionSchema);
      return { tasks, error: null };
    } catch (error) {
      // A badly shaped answer is worth one more try: the next sample may be fine.
      if (error instanceof AiSchemaError && attempt < 2) continue;
      if (error instanceof AiRefusedError) {
        return failed("The model declined to suggest tasks for this project.");
      }
      if (error instanceof AiError) {
        return failed(
          error.transient
            ? "No suggestions this time. Try again in a moment."
            : "Task suggestions are not set up on this server.",
        );
      }
      throw error;
    }
  }
}
```

Four things in it are worth knowing:

- **The schema is the contract.** `min(3)`, `max(120)`, `min(1)` and `max(8)` cannot be
  expressed in the JSON Schema the provider accepts, so they are left out of what the
  model sees and checked here when the answer arrives. `in()` is sent as an enum.
- **`SuggestedTask` mirrors the schema.** `Ai.object<T>()` returns the type you name. The
  schema is what enforces it at run time, so keep the two side by side.
- **A wrong shape is `AiSchemaError`.** It is _transient_: the next sample from the model
  may be fine, so the loop asks once more before giving up.
- **Every other failure is an `AiError`** with `transient` set. A refusal
  (`AiRefusedError`) gets its own sentence; anything transient, such as a rate limit,
  says to try again; anything permanent, such as no driver configured, says the feature
  is not set up. An error that is not an `AiError` is a bug, and is thrown.

## The page

A route that checks the policy first, so a request for someone else's project is refused
before the model is asked, and costs nothing:

```ts fragment
// app/routes/(auth)/(verified)/projects/[project]/suggestions.ts
import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Gate } from "zerotal/auth";
import type { Project } from "@app/models/Project";
import { suggestTasks } from "@app/support/suggestions";

export const meta = { GET: { name: "projects.suggestions" } };

// GET /projects/:project/suggestions — next tasks, suggested from the description.
export const GET = async (http: HttpContext<{ project: Project }>) => {
  const project = http.params.project;
  // Before the model is asked: a stranger's request should cost nothing.
  Gate.authorize("view", project);

  return Inertia.render("projects/suggestions", {
    title: `Suggested tasks for ${project.name}`,
    project: project.toPage(),
    ...(await suggestTasks(project)),
  });
};
```

The page is asked for each time it is opened. Every visit is a request to the model,
which is fine for a page a person opens on purpose.

Regenerate the route names:

```bash
# in your project root
bun zt route:types
```

The page lists the tasks, or shows the message in their place. The model's text is
rendered as text, like any other user content:

```tsx fragment
// resources/js/pages/projects/suggestions.tsx
import type { ReactNode } from "react";
import { Head } from "@inertiajs/react";
import AppLayout from "../../Layouts/AppLayout";
import { Alert } from "../../Components/Alert";
import { Badge } from "../../Components/Badge";
import { Card } from "../../Components/Card";
import { PageHeader } from "../../Components/PageHeader";
import type { Project } from "../../types";

interface SuggestedTask {
  title: string;
  priority: "low" | "normal" | "high";
}

interface Props {
  title: string;
  project: Project;
  tasks: SuggestedTask[];
  error: string | null;
}

const TONE = { low: "neutral", normal: "primary", high: "warning" } as const;

function Suggestions({ title, project, tasks, error }: Props) {
  return (
    <>
      <Head title={title} />
      <div className="max-w-2xl">
        <PageHeader
          title="Suggested tasks"
          description={`From the description of ${project.name}.`}
          back={{ href: route("projects.edit", { project: project.id }), label: project.name }}
        />

        {error ? (
          <Alert tone="warning">{error}</Alert>
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {tasks.map((task) => (
                <li key={task.title} className="flex items-center justify-between gap-4 px-5 py-3">
                  <span>{task.title}</span>
                  <Badge tone={TONE[task.priority]}>{task.priority}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

Suggestions.layout = (page: ReactNode) => <AppLayout>{page}</AppLayout>;

export default Suggestions;
```

Link to it from the edit page's header. The page with its new `actions`:

```tsx fragment
// resources/js/pages/projects/edit.tsx
import type { ReactNode } from "react";
import { Head } from "@inertiajs/react";
import AppLayout from "../../Layouts/AppLayout";
import { ButtonLink } from "../../Components/Button";
import { PageHeader } from "../../Components/PageHeader";
import { ProjectForm } from "../../Components/ProjectForm";
import type { Project } from "../../types";

interface Props {
  title: string;
  project: Project;
}

function EditProject({ title, project }: Props) {
  return (
    <>
      <Head title={title} />
      <div className="max-w-2xl">
        <PageHeader
          title={project.name}
          back={{ href: route("projects"), label: "Projects" }}
          actions={
            <ButtonLink
              variant="secondary"
              href={route("projects.suggestions", { project: project.id })}
            >
              Suggest tasks
            </ButtonLink>
          }
        />
        <ProjectForm project={project} />
      </div>
    </>
  );
}

EditProject.layout = (page: ReactNode) => <AppLayout>{page}</AppLayout>;

export default EditProject;
```

And add the page to `tests/pages.test.ts`, once with tasks and once with a message:

```ts fragment
// tests/pages.test.ts
import ProjectSuggestions from "../resources/js/pages/projects/suggestions";

// …in SIGNED_IN:
[
  "projects/suggestions",
  ProjectSuggestions,
  { title: "Suggested tasks", project: PROJECT, tasks: [], error: "Not set up." },
],
[
  "projects/suggestions",
  ProjectSuggestions,
  {
    title: "Suggested tasks",
    project: PROJECT,
    tasks: [{ title: "Write the launch post", priority: "high" }],
    error: null,
  },
],
```

## The tests

```ts fragment
// tests/suggestions.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AiFake } from "@zerotal/ai";
import { refreshDatabase, type TestApp } from "zerotal/testing";
import { ProjectFactory } from "../database/factories/ProjectFactory";
import { UserFactory } from "../database/factories/UserFactory";
import { bootApp } from "./support";

let app: TestApp;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(() => app.close());
beforeEach(() => app.actingAsGuest());

const relaunch = {
  name: "Website relaunch",
  description: "Move the marketing site to the new design and announce it on launch day.",
};

describe("task suggestions", () => {
  refreshDatabase();

  // Answers from a script: no network, no API key.
  let ai: AiFake;
  beforeEach(() => {
    ai = AiFake.install();
  });
  afterEach(() => ai.restore());

  test("lists the tasks the model suggests", async () => {
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create(relaunch);
    ai.respondWithObject({
      tasks: [
        { title: "Build the new page templates", priority: "high" },
        { title: "Write the launch announcement", priority: "normal" },
      ],
    });

    const res = await app.actingAs(user).get(`/projects/${project.id}/suggestions`);

    res.assertOk().assertInertia("projects/suggestions");
    res.assertInertiaProp("error", null);
    expect(res.inertia()?.props["tasks"]).toEqual([
      { title: "Build the new page templates", priority: "high" },
      { title: "Write the launch announcement", priority: "normal" },
    ]);
    ai.assertPrompted("announce it on launch day");
    ai.assertPromptCount(1);
  });

  test("asks again once when the answer has the wrong shape", async () => {
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create(relaunch);
    ai.respondWithObject(
      { tasks: [{ title: "Do it", priority: "urgent" }] }, // not a priority the schema allows
      { tasks: [{ title: "Build the new page templates", priority: "high" }] },
    );

    const res = await app.actingAs(user).get(`/projects/${project.id}/suggestions`);

    res.assertInertiaProp("tasks", [{ title: "Build the new page templates", priority: "high" }]);
    ai.assertPromptCount(2);
  });

  test("says so when the answer keeps the wrong shape", async () => {
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create(relaunch);
    ai.respondWithObject({ tasks: [] }); // fewer than one task; repeats for every call

    const res = await app.actingAs(user).get(`/projects/${project.id}/suggestions`);

    res.assertOk().assertInertiaProp("tasks", []);
    res.assertInertiaProp("error", "No suggestions this time. Try again in a moment.");
    ai.assertPromptCount(2);
  });

  test("says so when the model declines", async () => {
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create(relaunch);
    ai.refuse();

    const res = await app.actingAs(user).get(`/projects/${project.id}/suggestions`);

    res.assertOk();
    res.assertInertiaProp("error", "The model declined to suggest tasks for this project.");
  });

  test("does not ask the model about a project with no description", async () => {
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create({ description: null });

    const res = await app.actingAs(user).get(`/projects/${project.id}/suggestions`);

    res.assertInertiaProp("error", "Add a description to the project first.");
    ai.assertNothingPrompted();
  });

  test("refuses another user's project before asking the model", async () => {
    const owner = await UserFactory.create();
    const stranger = await UserFactory.create();
    const project = await ProjectFactory.for(owner).create(relaunch);

    (await app.actingAs(stranger).get(`/projects/${project.id}/suggestions`)).assertForbidden();
    ai.assertNothingPrompted();
  });
});
```

What each part relies on:

- **`AiFake.install()`** replaces the `ai` service with one that answers from a script
  and records every prompt. `restore()` in `afterEach` puts the real one back.
- **`respondWithObject()`** queues answers, used in order; the last one repeats. The fake
  checks each answer against the schema the call passes, exactly as the real driver
  checks the model's, and throws the same `AiSchemaError` when it does not fit. That is
  how the second and third tests drive the wrong-shape path: `"urgent"` is not one of
  the priorities, and an empty list is fewer than `min(1)`.
- **`refuse()`** makes the next call decline, as a provider's safety checks would. A
  refusal arrives as a successful response, so this is the path least likely to have
  run anywhere else.
- **`assertPrompted()`, `assertPromptCount()` and `assertNothingPrompted()`** are about
  what the app asked, which is the part you wrote. The last two tests prove that a
  project with nothing to go on, and a project that is not yours, never reach the model.

Whether the model's suggestions are good is not something a unit test can say. These
tests cover everything around it.

## Run it

```bash
# in your project root
bun zt test tests/suggestions.test.ts
bun zt test
```

Everything above runs without a key. To see what the app does with the feature off,
ask the AI commands:

```bash
# in your project root
bun zt ai:test
```

```
No AI drivers are configured. Add one under drivers in config/ai.ts.
```

The suggestions page says "Task suggestions are not set up on this server." in that
state. With `ANTHROPIC_API_KEY` set, `bun zt ai:test` reaches the provider once and
prints the model that answered; run it before you rely on the page.

`bun zt doctor` now warns that `AGENTS.md` describes a different project, because the
app has a package it did not have when the file was written. Refresh it:

```bash
# in your project root
bun zt arch:update
```

## See also

- [AI: Structured output](/docs/ai#structured-output): which constraints the model sees
  and which are checked afterwards.
- [AI: Testing](/docs/ai#testing): everything `AiFake` can script and assert.
- [AI: Refusals](/docs/ai#refusals): what a decline looks like and why it is a success
  response.
- [Validation](/docs/validator): the rules the schema is built from.
- [Authorization](/docs/authorization): the policy the route checks first.
