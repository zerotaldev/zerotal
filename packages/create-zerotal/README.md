# create-zerotal

> Scaffold a new Zerotal application in seconds with `bun create zerotal`.

`create-zerotal` is the interactive scaffolding CLI for the Zerotal framework. It prompts for a project name, a starter template, and (for the API template) a database, then generates the project and runs `bun install`.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

> **Bun is required.** The CLI entry (`src/index.ts`) uses a `#!/usr/bin/env bun` shebang and the Bun runtime APIs (`Bun.file`, `Bun.env`). It cannot run under Node — `npx create-zerotal` / `npm create zerotal` will fail; use `bun create zerotal`.

## Usage

```bash
bun create zerotal my-app
# or
bunx create-zerotal my-app
```

The CLI is interactive: if you omit the project name it prompts for one (default `my-zerotal-app`), then asks you to choose a template and, for the `api` template, a database. It aborts rather than overwrite a directory that already contains a `package.json`.

### Templates

| Template  | Description                                                                   |
| --------- | ----------------------------------------------------------------------------- |
| `api`     | JSON REST API — core, ORM, auth, validation, testing. Prompts for a database. |
| `admin`   | Admin panel — resources, auth, dashboard widgets, seeded demo data.           |
| `flow`  | Server-driven UI — Flow pages, top nav, Tailwind.                           |
| `react`   | Inertia + React SPA — file-based routes, Tailwind.                            |
| `vue`     | Inertia + Vue SPA — file-based routes, Tailwind.                              |
| `minimal` | Single page, JSX views, Tailwind — the bare framework.                        |

### Databases (api template only)

| Choice     | Notes                                               |
| ---------- | --------------------------------------------------- |
| `sqlite`   | Zero setup, file-based — great for getting started. |
| `postgres` | Requires a `DATABASE_URL` env var.                  |
| `mysql`    | Requires a `DATABASE_URL` env var.                  |

### Next steps

After scaffolding, the CLI prints the next commands:

```bash
cd my-app
# (set DATABASE_URL in .env for a non-sqlite api project)
bun zt migrate   # api template only
bun zt db:seed   # admin template — demo data plus the first account
bun zt dev
```

The `admin` template's panel is behind a sign-in, so seeding is what makes a fresh
app usable rather than a locked door: it creates `admin@example.com` with the
password `password`, alongside a small demo catalogue. Open `/admin`.

## Documentation

- [Scaffolding](../../docs/scaffolding.md)
