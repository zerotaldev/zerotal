# {{name}}

A full-stack TypeScript app: server-rendered Flow pages from [Zerotal](https://zerotal.dev) on
Bun, with sign-in, settings and an example resource already built.

## Requirements

- [Bun](https://bun.sh) 1.3.14 or newer. Node.js is not supported: Zerotal uses Bun-native APIs
  throughout.

## Getting started

{{getting_started}}

### Demo account

`bun zt db:seed` creates a user with a dozen sample projects:

| Email              | Password   |
| ------------------ | ---------- |
| `demo@example.com` | `password` |

It is for local development only — never seed a production database with it.

## What is included

- **Sign-in:** registration, sign in and out, "keep me signed in", password reset, and a lockout
  after five failed attempts that says how long to wait.
- **Email verification:** new accounts confirm their address before reaching the dashboard. In
  development mail is written to the terminal running the server, links included.
- **Two-factor authentication:** any user can turn it on in Settings, with a QR code, recovery
  codes and a code prompt at sign-in.
- **Passkeys** _(optional)_: sign in with a fingerprint, face or device PIN. Off until
  `PASSKEY_RP_ID` is set in `.env`.
- **Sign in with GitHub or Google** _(optional)_: each provider is on once its keys are in `.env`.
- **Settings:** profile, password, appearance (light, dark or system), two-factor, passkeys,
  signed-in sessions, and deleting the account.
- **An example resource, `Project`:** a searchable, paginated list, create and edit forms, and a
  policy that keeps each project private to its owner.
- **Tests** for every flow above, a CI workflow, a Dockerfile and a `/health` endpoint.

## Where things live

| Path                            | What it holds                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `routes/web.ts`                 | Every page: its URL, its route name, and who may see it                           |
| `app/flow/pages/`               | One Flow component per screen, rendered on the server                             |
| `app/flow/layouts/`             | The signed-in sidebar, the sign-in card, the public site and settings             |
| `app/flow/components/`          | Buttons, fields, dialogs, menus, toasts — the shared vocabulary                   |
| `app/routes/`                   | What the forms send, one file per URL, grouped by who may (`(guest)/`, `(auth)/`) |
| `app/routes/(auth)/(verified)/` | Routes that also need a confirmed email address                                   |
| `app/models/`                   | `User` and `Project`                                                              |
| `app/policies/`                 | Who may do what with a model                                                      |
| `app/auth/`                     | Sessions, passkeys and social sign-in helpers                                     |
| `app/notifications/`            | The emails the app sends                                                          |
| `resources/js/`                 | The browser script: menus, dialogs, the theme, PUT/DELETE forms and passkeys      |
| `resources/css/app.css`         | Design tokens. Every colour in the app starts here                                |
| `database/`                     | Migrations, factories and the demo seeder                                         |
| `tests/`                        | Feature tests, run with the app booted                                            |

A page is a class in `app/flow/pages/` whose `render()` runs on the server, so it reads the
database and the signed-in user directly and the browser gets finished HTML. `routes/web.ts`
puts it at a URL. Its forms are ordinary HTML: they post to the file in `app/routes/` at the
same URL, which validates, saves and redirects, and the next page shows the result — the errors
and what was typed (`this.error()`, `this.old()`), or a toast.

A browser form can only GET or POST, so a form that updates or deletes says so with
`data-method="put"` (or `patch`, `delete`), and `resources/js/lib/forms.ts` sends it with that
verb. The project search is the one live page: its box is bound to a Flow property, and the
list re-renders on the server as you type.

## Scripts

| Command             | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `bun run dev`       | Start the dev server with hot reload                |
| `bun run start`     | Start the server without dev tooling                |
| `bun run build`     | Build the stylesheet and browser script for release |
| `bun run test`      | Run the test suite                                  |
| `bun run typecheck` | Type-check without emitting                         |
| `bun run seed`      | Create the demo account and its projects            |
| `bun zt <command>`  | Any framework command; `bun zt list` shows them all |

## Configuration

Environment variables live in `.env`, documented in `.env.example`. `APP_KEY` was generated for
this project when it was scaffolded — keep it out of version control, and use a different one
per environment. `APP_NAME` is the name shown in page titles, the sidebar, outgoing mail and
authenticator apps.

### Mail

`MAIL_DRIVER=log` prints every message to the server's output. Set it to `smtp` (with the
`SMTP_*` variables) or `resend` (with `RESEND_API_KEY`) to send for real, and set
`MAIL_FROM_ADDRESS` to an address you own.

### Passkeys

Set `PASSKEY_RP_ID` to the domain the app is served on — `localhost` in development. A passkey is
bound to that domain, so pick it once. `PASSKEY_ORIGIN` defaults to `APP_URL`.

### GitHub and Google

Register an OAuth app with the provider, set its callback URL to
`<APP_URL>/auth/github/callback` (or `/google/`), and put its id and secret in `.env` as
`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` or `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. The
sign-in page shows a button for each provider that is set.

## Tests and CI

`bun run test` boots the app against a fresh in-memory database for each file and runs the
feature tests in `tests/` — every sign-in flow, every settings page and every action on a
project. Mail is faked in tests; nothing is sent.

`.github/workflows/ci.yml` runs the format check, the type check, the tests and the production
build on every push and pull request.

## Deploying

The `Dockerfile` installs, builds the stylesheet and browser script, and runs `bun zt migrate` then `bun zt serve` on
port 3000. At run time the container needs `APP_KEY`, `APP_ENV=production` (set in the image),
`APP_URL`, a `DATABASE_URL` on a persistent volume or server, and `HEALTH_KEY` for its health
check, which calls `/health` with it. See the
[deployment guide](https://zerotal.dev/docs/deployment) for the rest.

## Remove the example

`Project` is there to show a resource end to end. To build your own in its place, delete:

- `app/models/Project.ts`, `app/policies/ProjectPolicy.ts`, `app/requests/ProjectRequest.ts`
- `app/routes/(auth)/(verified)/projects/`
- `database/migrations/0006_create_projects_table.ts` and `database/factories/ProjectFactory.ts`
- `app/flow/pages/projects/`, and `ProjectForm.tsx`, `ProjectStatusBadge.tsx` and
  `Pagination.tsx` (if nothing else uses it) in `app/flow/components/`
- `tests/projects.test.ts` and `tests/project-policy.test.ts`

Then edit:

- `routes/web.ts` — the three project pages, and their imports
- `app/flow/layouts/AppLayout.tsx` — the "Projects" line in `NAV`
- `app/flow/pages/dashboard.tsx` — the project counts and the recent list
- `app/routes/(auth)/settings/delete-account.ts` — the line that deletes the user's projects
- `database/seeders/DatabaseSeeder.ts` — the sample projects
- `tests/pages.test.ts` — the project pages, and the dashboard's state with a project in it

Run `bun zt route:types`, `bun run typecheck` and `bun run test` to confirm nothing still refers
to it. On a database that already ran the migration, add one that drops the `projects` table.

## Documentation

Full documentation is at [zerotal.dev/docs](https://zerotal.dev/docs).
