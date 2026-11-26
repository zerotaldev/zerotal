---
title: Scaffold and Run
description: Milestone 1 of the tutorial — scaffold a Zerotal app from the React starter, migrate, seed and run it, and sign in as the demo user.
---

# Scaffold and Run

Milestone 1 of 9 in [Build Your First App](/docs/tutorial).

## Scaffold the app

```bash
# in the directory that will hold the project
bunx create-zerotal@1.17.4 my-app --template=react --yes
cd my-app
```

`--yes` takes the defaults for anything not given on the command line. Leave both flags
off to be asked instead. The scaffolder installs the dependencies, writes `.env` with a
fresh `APP_KEY`, and ends by printing the next steps:

```
  Next steps:
     cd my-app
     bun zt migrate
     bun zt db:seed              # optional: demo@example.com / password with sample projects
     bun zt dev
```

> **On Vue** — use `--template=vue`. **On Flow** — use `--template=flow`. Everything on
> this page is the same.

## Create the database and run it

```bash
# in your project root
bun zt migrate
bun zt db:seed
bun zt dev
```

`migrate` builds the SQLite database at `database/db.sqlite` from the six migrations the
starter ships. `db:seed` adds a demo user with twelve projects. `dev` starts the server
and rebuilds the frontend when a file changes. (A queue worker joins it in
[milestone 6](/docs/tutorial/notifications), once the app has jobs to run.)

```
  Zerotal v1.17.4  ›  dev

  Local    http://localhost:3000
```

Leave it running in its own terminal for the rest of the tutorial.

## Check it

Open <http://localhost:3000/login> and sign in as `demo@example.com` with the password
`password`. You land on the dashboard; **Projects** in the sidebar lists the demo
projects, ten to a page.

Two more checks, from a second terminal, that the starter is sound before you change
anything:

```bash
# in your project root
bun zt test
bun zt doctor
```

`bun zt test` ends with `0 fail` (on the React starter, `102 pass`). `bun zt doctor` ends with
`All 22 checks passed.`

## What you have

The files worth reading before the next milestone are the example resource's. Every
milestone copies one of them:

| File                             | What it is                                     |
| -------------------------------- | ---------------------------------------------- |
| `app/models/Project.ts`          | The model, and `toPage()`: what a page is sent |
| `app/policies/ProjectPolicy.ts`  | Only the owner may see, change or delete       |
| `app/requests/ProjectRequest.ts` | The form's validation rules                    |
| `app/routes/(auth)/(verified)/`  | The routes: the file path is the URL           |
| `resources/js/pages/projects/`   | The pages                                      |
| `database/factories/`            | Test data                                      |
| `tests/projects.test.ts`         | Every action, including the refusals           |

[Directory Structure](/docs/structure) explains the rest of the layout, and
[Conventions](/docs/conventions) what is found without being registered.

**Next:** [A model and a migration](/docs/tutorial/model).
