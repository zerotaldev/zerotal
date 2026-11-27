---
name: zerotal-crud-resource
description: "Add a resource users create, list, edit and delete in a Zerotal app — model, schema, factory, policy, validation, routes, pages and tests, in the order that keeps each step checkable."
---

<!-- zerotal:arch:generated -->

# Adding a resource

If this app still has the starter's example `Project` resource, it is the pattern to copy:
`app/models/Project.ts`, its migration and factory, `app/policies/ProjectPolicy.ts`,
`app/requests/ProjectRequest.ts`, the routes under `projects/`, its pages and
`tests/projects.test.ts`. Read those before writing anything — they answer most of the
questions below the way this app already answers them.

## Start from a generator

Once the model exists (step 1), one command writes steps 3 to 6 the way the starter wrote
`Project`, owner-scoped when the model has a `userId`, passing `typecheck`,
`format:check` and its own test as written:

- **Inertia (React or Vue):** `bun zt make:resource <Name> --model <Name>` — the routes under
  `app/routes/`, a request, a policy, the pages and their shared form, and `tests/<names>.test.ts`.
  `bun zt make:route <path>` adds one more file route beside them.
- **Flow:** `bun zt make:flow <Name>Page --crud --model <Name>` — one live page that lists,
  creates, edits and deletes.

Then read what it wrote and change it; the steps below are what it did, and what to check.

## Sequence

1. **Model and schema.** Run `doctor` and read which owns the schema here — models or migrations — before deciding whether `make:model` needs `-m`. Make the model's `table(...)` name and the
   migration's table name agree; nothing checks it until the first query.
2. **Factory.** `bun zt make:factory <Name>` — the model's name; it writes `<Name>Factory`. Tests and seeders both need one.
3. **Policy.** `bun zt make:policy <Name>Policy --model <Name>`. Policies in
   `app/policies/` are discovered; there is nothing to register.
4. **Validation.** `bun zt make:request <Name>Request`, one request for create and update
   unless the rules really differ.
5. **Routes and pages**, in whichever style this app already uses — look at `routes/` and
   `app/routes/` before adding either. Then `bun zt route:types`.
6. **Tests**, then `bun zt test` and `bun zt doctor`.

## Traps

- **Set the owner in code, never from the form.** `fill()` the validated fields, then
  assign `userId` (or `tenantId`) from `Auth.user()`. A form field named `user_id` is an
  invitation to write someone else's record.
- **Load records through their owner.** A route with `:id` in it is reachable with every id.
  Either scope the query to the signed-in user or check the policy on _every_ action that
  loads one — show, edit, update and delete, not just the ones with a button.
- **Test the negative.** One test where a second user asks for the first user's record and
  is refused. It is the test that catches the trap above, and the one nobody writes.
- **Paginate the index.** `.paginate(perPage, page)` from the start; an unbounded list is a
  slow page the day a real user has real data.

Read signatures with `api_surface` (`@zerotal/orm`, `@zerotal/validator`) rather than
from memory.
