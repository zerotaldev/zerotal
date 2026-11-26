---
title: Validate the Form
description: Milestone 4 of the tutorial — rules for a task's title and an optional assignee, a blank field that counts as absent, and the errors the form shows.
---

# Validate the Form

Milestone 4 of 9 in [Build Your First App](/docs/tutorial).

Right now a task's title can be a single space, and there is nowhere to say who a task
is for. This milestone adds both: a title of a sensible length, and an optional
**Assign to** field that takes the email address of someone with an account.

## The rules

```ts
// app/requests/TaskRequest.ts
import { FormRequest } from "zerotal/validator";
import type { RuleBuilder } from "zerotal/validator";

/** What the "add a task" form must contain. */
export class TaskRequest extends FormRequest {
  rules(r: RuleBuilder) {
    return {
      title: r.string().trim().min(2).max(200),
      // Optional: a task can be nobody's yet. When given, it must be someone with an account.
      assignee: r.string().trim().email().exists("users", "email").optional(),
    };
  }

  // A blank input posts "", which is a string, not an absent field. Treat it as absent.
  override prepareForValidation(body: Record<string, unknown>) {
    if (body["assignee"] === "") delete body["assignee"];
    return body;
  }
}
```

`trim()` runs before the length check, so spaces do not count towards it.
`exists("users", "email")` asks the database. [Validation](/docs/validator) lists every
rule.

`prepareForValidation()` is there because of how forms work. An empty input is sent as
`""`, and for a string field `""` is a value, not a missing one, so `optional()` alone
would let it through to `email()` and fail it. Removing the key makes a blank field
count as not given. See [Preparing input](/docs/validator#preparing-input).

When validation fails, `TaskRequest.validate()` does not return: it sends the visitor
back to the form, with the messages in the page's `errors` prop and what they typed in
`old`. Your route code only ever sees valid data.

## Use the assignee

The route looks the address up and stores the user's id:

```ts fragment
// app/routes/(auth)/(verified)/projects/[project]/tasks.ts
import { User } from "@app/models/User";

// …in POST, after the projectId line:
const assignee = data.assignee ? await User.query().where("email", data.assignee).first() : null;
task.assigneeId = assignee?.id ?? null;
```

## Show the field

Add `assignee` to the form's data in `resources/js/pages/projects/show.tsx`, and a
second field under the title. `TextField` shows the error under the input when there
is one, and the hint otherwise:

```tsx fragment
// resources/js/pages/projects/show.tsx
const form = useForm({ title: "", assignee: "" });

// …in the form, after the "New task" field:
<TextField
  label="Assign to"
  type="email"
  hint="Optional. The email address of someone with an account."
  value={form.data.assignee}
  error={form.errors.assignee}
  onChange={(e) => form.setData("assignee", e.target.value)}
/>;
```

> **On Vue** — the same two changes in `show.vue`: `assignee: ""` in `useForm()`, and
> `<TextField v-model="form.assignee" label="Assign to" type="email" … />` with
> `:error="form.errors.assignee"`.

> **On Flow** — read errors with `this.error("assignee")` and the value typed with
> `this.old("assignee")`, as `app/flow/pages/projects/create.tsx` does for its fields.
> Give the input `name="assignee"` and an element with `data-error-for="assignee"` for
> the message.

## Check it

On a project's page, type `x` as the title and `nobody@example.com` as the assignee, and
add it. The form comes back with both fields filled in and two messages:

```
The title field must be at least 2 characters.
The selected assignee is invalid.
```

Now give it a proper title and leave **Assign to** blank: the task is added. Then add
one assigned to `demo@example.com`, which exists.

**Next:** [A policy](/docs/tutorial/policy).
